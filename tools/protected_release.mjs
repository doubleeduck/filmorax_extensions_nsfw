import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ed25519PrivateKey, resolveReleaseVersion } from './release_version.mjs';
import { createPublicKey } from 'node:crypto';
import { prepareRelease } from './release.mjs';
import { readRepositoryConfig } from './repository_config.mjs';
import { verifyReleaseDirectory } from './verify_release.mjs';

function git(args, root) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error('Release Git verification failed');
  return result.stdout.trim();
}
export function assertReleaseCheckout({ root, env, version }) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '') ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(env.GITHUB_REPOSITORY ?? '')
  )
    throw Error('A protected GitHub release workflow is required');
  const expected = env.GITHUB_SHA;
  if (
    git(['rev-parse', 'HEAD'], root) !== expected ||
    git(['rev-parse', `refs/tags/v${version}^{commit}`], root) !== expected ||
    git(['status', '--porcelain', '--untracked-files=all'], root)
  )
    throw Error('The clean checkout, existing release tag and workflow SHA must agree');
}

export async function protectedRelease({
  root = process.cwd(),
  env = process.env,
  publish = false,
} = {}) {
  const version = resolveReleaseVersion({
    requestedVersion: env.RELEASE_VERSION,
    refType: env.GITHUB_REF_TYPE,
    refName: env.GITHUB_REF_NAME,
  });
  assertReleaseCheckout({ root, env, version });
  const config = await readRepositoryConfig(root);
  if (!config) throw Error('A classified standalone extension repository is required');
  const fingerprint = env.FILMORAX_PUBLISHER_FINGERPRINT;
  if (
    !/^[a-f0-9]{64}$/u.test(fingerprint ?? '') ||
    (env.FILMORAX_PUBLISHER_KEY_ID && env.FILMORAX_PUBLISHER_KEY_ID !== config.publisherKeyId)
  )
    throw Error('Configure the protected publisher key ID and public fingerprint');
  const output = join(root, 'dist', `release-${version}`);
  if (!publish) {
    const encoded = env.FILMORAX_SIGNING_KEY_BASE64;
    // Do not let esbuild or any later subprocess inherit the signing secret.
    delete env.FILMORAX_SIGNING_KEY_BASE64;
    if (
      !encoded ||
      encoded.length > 16384 ||
      encoded.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
    )
      throw Error('Configure an Ed25519 PKCS8 PEM key in the protected signing secret');
    const privateBytes = Buffer.from(encoded, 'base64');
    try {
      const key = ed25519PrivateKey(privateBytes);
      const rawPublic = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32);
      if (createHash('sha256').update(rawPublic).digest('hex') !== fingerprint)
        throw Error('Signing key does not match the independently configured public fingerprint');
      await prepareRelease({ root, key, keyId: config.publisherKeyId, output, version });
    } finally {
      privateBytes.fill(0);
    }
  }
  const verified = await verifyReleaseDirectory({
    directory: output,
    config,
    fingerprint,
    version,
  });
  if (publish) {
    if (!env.GH_TOKEN) throw Error('A release-scoped GitHub token is required for publishing');
    const result = spawnSync(
      'gh',
      [
        'release',
        'create',
        `v${version}`,
        '--verify-tag',
        '--repo',
        env.GITHUB_REPOSITORY,
        '--title',
        `${config.name} ${version}`,
        '--notes',
        'Signed FilmoraX extensions. Verify the publisher fingerprint independently.',
        ...verified.files.map((file) => join(output, file)),
        ...(version.includes('-') ? ['--prerelease'] : []),
      ],
      { cwd: root, stdio: 'inherit', env: { ...env, FILMORAX_SIGNING_KEY_BASE64: '' } },
    );
    if (result.status !== 0) throw Error('Release publication failed; no overwrite was attempted');
  }
  return verified.catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await protectedRelease({ publish: process.argv.includes('--publish') });
}
