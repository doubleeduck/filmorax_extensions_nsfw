import { generateKeyPairSync, createHash } from 'node:crypto';
import { join } from 'node:path';
import { prepareRelease } from './release.mjs';
import { readRepositoryConfig } from './repository_config.mjs';
import { verifyReleaseDirectory } from './verify_release.mjs';

const root = process.cwd(),
  config = await readRepositoryConfig(root);
if (!config) throw Error('Run from a classified standalone repository');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const output = join(root, 'dist', 'ci-release');
const keyId = 'ci.test.only';
await prepareRelease({ root, key: privateKey, keyId, version: '0.0.0-ci.1', output });
await verifyReleaseDirectory({
  directory: output,
  config: { ...config, publisherKeyId: keyId },
  version: '0.0.0-ci.1',
  fingerprint: createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
    .digest('hex'),
});
console.log(
  'CI-only packages verified. The ephemeral key was not saved and is not a trusted publisher.',
);
