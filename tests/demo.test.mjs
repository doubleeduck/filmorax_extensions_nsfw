import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import createSource from '../examples/demo/src/index.mjs';
import { pack } from '../tools/pack.mjs';
import { verifyPackage } from '../tools/package_format.mjs';

test('complete SDK demo has stable pagination, filtering, details and native stream DTOs without network', async () => {
  const source = createSource({ baseUrl: 'https://catalog.example.org' });
  const page = await source.getPopular();
  assert.equal(page.items.length, 1);
  assert.deepEqual(await source.getLatest({ page: 2 }), { items: [], hasMore: false });
  assert.deepEqual(await source.search({ searchTerm: 'absent' }), { items: [], hasMore: false });
  assert.equal((await source.getFilters()).length, 1);
  const detail = await source.loadDetails({ itemId: page.items[0].id });
  assert.equal(detail.playbackGroups[0].playerId, 'demo-native');
  const stream = await source.resolveStream({ url: detail.playbackGroups[0].episodes[0].url });
  assert.equal(stream.variants[0].mimeType, 'application/vnd.apple.mpegurl');
  assert.equal(await source.loadDetails({ itemId: 'absent' }), null);
  await assert.rejects(() => source.resolveStream({ url: 'file:///private' }));
  const { privateKey } = generateKeyPairSync('ed25519');
  const packed = await pack({
    project: fileURLToPath(new URL('../examples/demo', import.meta.url)),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    keyId: 'test.demo',
  });
  const manifest = verifyPackage(
    packed.archive,
    Buffer.from(packed.publicRecord.publicKey, 'base64'),
  );
  assert.equal(manifest.id, 'example.source.demo');
});
