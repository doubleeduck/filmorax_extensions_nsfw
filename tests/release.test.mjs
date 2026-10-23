import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createHash, verify } from 'node:crypto';
import { prepareRelease, releaseSignatureDomain } from '../tools/release.mjs';
import { canonicalJson, verifyPackage } from '../tools/package_format.mjs';
import { readRepositoryConfig } from '../tools/repository_config.mjs';

test('classified distributions use one explicit publisher and reproducible signed packages', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'filmorax-release-test-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const config = await readRepositoryConfig(root);
    const sourceManifests = await Promise.all(
      (await readdir(join(root, 'sources'))).map(async (name) =>
        JSON.parse(await readFile(join(root, 'sources', name, 'manifest.json'), 'utf8')),
      ),
    );
    for (const channel of config ? [config.channel] : ['all', 'standard', 'nsfw']) {
      const output = join(temporary, channel);
      const result = await prepareRelease({
        key,
        keyId: 'test.release',
        output,
        channel,
        version: '2.3.4',
      });
      const selected = sourceManifests.filter(
        (m) => channel === 'all' || m.sources.some((s) => s.isNsfw) === (channel === 'nsfw'),
      );
      assert.equal(result.sourceCount, selected.flatMap((m) => m.sources).length);
      assert.equal(result.catalog.packages.length, selected.length + (channel !== 'nsfw' ? 1 : 0));
      const catalog = await readFile(join(output, 'release.json'));
      assert.equal(catalog.toString(), canonicalJson(result.catalog));
      assert.equal(
        verify(
          null,
          Buffer.concat([releaseSignatureDomain, catalog]),
          publicKey,
          await readFile(join(output, 'release.ed25519')),
        ),
        true,
      );
      const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
      assert.equal(result.publisher.publicKey, rawPublic.toString('base64'));
      for (const entry of result.catalog.packages) {
        const bytes = await readFile(join(output, entry.file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
        const manifest = verifyPackage(bytes, rawPublic);
        assert.equal(manifest.publisherKeyId, 'test.release');
        assert.equal(manifest.id, entry.id);
        assert.equal(manifest.version, '2.3.4');
        if (channel !== 'all')
          assert.equal(
            manifest.sources.some((source) => source.isNsfw),
            channel === 'nsfw',
          );
      }
      await assert.rejects(() => prepareRelease({ key, keyId: 'test.release', output, channel }), {
        code: 'EEXIST',
      });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
