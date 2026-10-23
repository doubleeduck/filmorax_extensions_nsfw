import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, cp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedRelease, assertReleaseCheckout } from '../tools/protected_release.mjs';
import { verifyReleaseDirectory } from '../tools/verify_release.mjs';

test('protected release verifies a clean exact tag and fingerprint, never saves a private key or publishes during tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'filmorax-protected-release-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
    .digest('hex');
  const config = {
    schemaVersion: 1,
    name: 'Fixture',
    channel: 'standard',
    publisherKeyId: 'test.release',
    sourceIds: ['example.demo'],
    hostFeatures: [],
  };
  const git = (args) => {
    const result = spawnSync(
      'git',
      ['-c', `core.hooksPath=${join(root, 'empty-hooks')}`, '-c', 'commit.gpgSign=false', ...args],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await mkdir(join(root, 'empty-hooks'));
    await mkdir(join(root, 'sources'));
    await cp(
      fileURLToPath(new URL('../examples/demo', import.meta.url)),
      join(root, 'sources/demo'),
      { recursive: true },
    );
    await writeFile(join(root, 'repository.json'), JSON.stringify(config));
    await writeFile(join(root, '.gitignore'), 'dist/\n');
    git(['init', '--quiet', '--template', join(root, 'empty-hooks')]);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    ]);
    git(['tag', 'v1.2.3']);
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v1.2.3',
      GITHUB_SHA: git(['rev-parse', 'HEAD']),
      GITHUB_REPOSITORY: 'fixture/extensions',
      FILMORAX_PUBLISHER_FINGERPRINT: fingerprint,
      FILMORAX_PUBLISHER_KEY_ID: 'test.release',
      FILMORAX_SIGNING_KEY_BASE64: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'pem' }),
      ).toString('base64'),
    };
    const original = { ...env };
    assert.throws(() =>
      assertReleaseCheckout({
        root,
        env: { ...env, GITHUB_SHA: '0'.repeat(40) },
        version: '1.2.3',
      }),
    );
    await assert.rejects(() =>
      protectedRelease({ root, env: { ...env, FILMORAX_PUBLISHER_FINGERPRINT: '0'.repeat(64) } }),
    );
    const catalog = await protectedRelease({ root, env });
    assert.equal(env.FILMORAX_SIGNING_KEY_BASE64, undefined);
    assert.equal(catalog.packages[0].version, '1.2.3');
    const directory = join(root, 'dist/release-1.2.3');
    const verified = await verifyReleaseDirectory({
      directory,
      config,
      fingerprint,
      version: '1.2.3',
    });
    assert.equal(verified.catalog.packages.length, 1);
    await assert.rejects(
      () => protectedRelease({ root, env, publish: true }),
      /token is required/u,
    );
    await assert.rejects(() => protectedRelease({ root, env: { ...original } }), {
      code: 'EEXIST',
    });
    await writeFile(join(root, 'untracked.txt'), 'not committed');
    assert.throws(() => assertReleaseCheckout({ root, env, version: '1.2.3' }), /clean checkout/u);
    await rm(join(root, 'untracked.txt'));
    const archivePath = join(directory, catalog.packages[0].file);
    const bytes = await readFile(archivePath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(archivePath, bytes);
    await assert.rejects(
      () => verifyReleaseDirectory({ directory, config, fingerprint, version: '1.2.3' }),
      /checksum/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
