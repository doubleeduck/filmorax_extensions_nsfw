import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pack } from '../tools/pack.mjs';
import { verifyPackage } from '../tools/package_format.mjs';
import { readRepositoryConfig } from '../tools/repository_config.mjs';
test('every authored source package is self-contained, reproducible and signed', async () => {
  const { privateKey } = generateKeyPairSync('ed25519'),
    key = privateKey.export({ type: 'pkcs8', format: 'pem' }),
    sources = new Set();
  for (const name of await readdir(new URL('../sources/', import.meta.url))) {
    const project = fileURLToPath(new URL(`../sources/${name}/`, import.meta.url));
    const a = await pack({ project, key, keyId: 'test.publisher' }),
      b = await pack({ project, key, keyId: 'test.publisher' });
    assert.deepEqual(a.archive, b.archive);
    const manifest = verifyPackage(a.archive, Buffer.from(a.publicRecord.publicKey, 'base64'));
    for (const source of manifest.sources) {
      assert.equal(sources.has(source.id), false);
      sources.add(source.id);
    }
    assert.equal(Object.keys(manifest.files).filter((name) => name.endsWith('.mjs')).length, 1);
  }
  const config = await readRepositoryConfig(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(sources.size, config?.sourceIds.length ?? 16);
  if (config) assert.deepEqual([...sources].sort(), [...config.sourceIds].sort());
});
