import test from 'node:test';
import assert from 'node:assert/strict';
import { aaFixture } from './support/aa_fixture.mjs';
import { decodeSettings } from '../sources/animefox/src/aa.mjs';
import { serializedFilters, slug } from '../sources/animefox/src/index.mjs';
import { createTentacl, decryptResponse } from '../sources/animefox/src/tentacl.mjs';
import { pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
test('AnimeFox AA decoding produces only settings data without evaluating page JavaScript', () => {
  assert.deepEqual(
    decodeSettings(aaFixture('baseURL="https://x.tentacl.su/";ps="token";ts=123;enabled=true;')),
    { baseURL: 'https://x.tentacl.su/', ps: 'token', ts: '123', enabled: 'true' },
  );
  const filters = new URLSearchParams(
    serializedFilters({
      section: ['hentai'],
      include_genres: ['3'],
      exclude_genres: ['4'],
      studio: ['studio'],
    }),
  );
  assert.deepEqual(filters.getAll('cat'), ['102', '3']);
  assert.equal(filters.get('!cat'), '4');
  assert.equal(filters.get('stydi'), 'studio');
  assert.equal(slug('https://www.animefox.org/hentai/2935-fixture.html'), '2935-fixture');
});
test('AnimeFox retains PBKDF2/AES legacy and signed-response envelope compatibility', async () => {
  const salt = Buffer.alloc(16, 3),
    password = 'fixture',
    derived = pbkdf2Sync(password, salt, 10000, 48, 'sha256'),
    cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32)),
    plain = '{"sources":[]}',
    envelope = Buffer.concat([salt, cipher.update(plain), cipher.final()]).toString('base64url');
  const context = {
    crypto: {
      pbkdf2Sha256: async ({ password, salt, iterations, length }) =>
        pbkdf2Sync(password, Buffer.from(salt, 'base64'), iterations, length, 'sha256').toString(
          'base64',
        ),
      aesCbcDecrypt: async ({ key, iv, ciphertext }) => {
        const decipher = createDecipheriv(
          'aes-256-cbc',
          Buffer.from(key, 'base64'),
          Buffer.from(iv, 'base64'),
        );
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      },
    },
  };
  assert.equal(await decryptResponse(context, envelope, password), plain);
  await assert.rejects(() => decryptResponse(context, envelope, 'wrong'));
});
test('Tentacl preserves a player base path for legacy endpoints and relative media', async () => {
  const calls = [];
  const settings = aaFixture(
    'baseURL="https://x.tentacl.su/engine/";' +
      `apx="${Buffer.from('https://x.tentacl.su/engine/config/').toString('base64')}";` +
      'qsx="token";ps="seed";pd="fixture";kaken="payload";',
  );
  const context = {
    html: { extract: async () => [] },
    http: {
      request: async (request) => {
        calls.push(request);
        if (request.url.includes('/embed/')) return { body: settings };
        if (request.method === 'POST')
          return {
            body: JSON.stringify({
              sources: [{ file: 'native/720p.mp4', type: 'mp4' }],
            }),
          };
        return { body: '{}' };
      },
    },
  };
  const result = await createTentacl(context).resolve('https://x.tentacl.su/embed/fixture');
  assert.equal(
    calls.find((r) => r.method === 'POST').url,
    'https://x.tentacl.su/engine/api/?p=seed',
  );
  assert.equal(result.variants[0].url, 'https://x.tentacl.su/engine/native/720p.mp4');
  assert.equal(result.variants[0].headers.Origin, 'https://x.tentacl.su');
});
