import test from 'node:test';
import assert from 'node:assert/strict';
import { aaFixture } from './support/aa_fixture.mjs';
import { decodeSettings } from '../sources/animefox/src/aa.mjs';
import createSource, { serializedFilters, slug } from '../sources/animefox/src/index.mjs';
import { createTentacl, decryptResponse } from '../sources/animefox/src/tentacl.mjs';
import { pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';

test('Tentacl declares the native HLS compatibility quirk instead of relying on Dart host names', async () => {
  const resolver = createTentacl({});
  assert.equal(
    (await resolver.resolve('https://x.tentacl.su/hls/plain.m3u8')).variants[0].requiresHlsProxy,
    true,
  );
  assert.equal(
    (await resolver.resolve('https://x.tentacl.su/native.mp4')).variants[0].requiresHlsProxy,
    false,
  );
});
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

function inspectionFixture({ multiplePlaylists = false } = {}) {
  const settings = aaFixture(
    'baseURL="https://x.tentacl.su/";' +
      `apx="${Buffer.from('https://x.tentacl.su/config/').toString('base64')}";` +
      'qsx="token";ps="seed";pd="fixture";kaken="payload";',
  );
  const calls = [];
  const context = {
    baseUrl: 'https://www.animefox.org',
    parameters: {},
    settings: { network: async () => ({}) },
    html: {
      extract: async (body) =>
        body === 'iframe'
          ? 'https://x.tentacl.su/embed/fixture'
          : body === 'episodes'
            ? [{ number: '1', title: 'Episode 1' }]
            : [{ id: 'one', url: '/embed/fixture?alt=1', title: 'Server 1', classes: 'active' }],
    },
    http: {
      request: async (request) => {
        calls.push(request);
        if (request.url.includes('/index.php?'))
          return { body: { success: true, player: 'iframe', selectors: 'episodes' } };
        if (request.url.includes('/embed/')) return { body: settings };
        if (request.method === 'POST')
          return {
            body: JSON.stringify({
              sources: multiplePlaylists
                ? [720, 480, 360, 240].map((label) => ({
                    file: `hls/${label}p.m3u8`,
                    type: 'hls',
                    label: String(label),
                  }))
                : [{ file: 'native/720p.mp4', type: 'mp4' }],
            }),
          };
        return { body: '{}' };
      },
    },
  };
  return { calls, context };
}

test('server inspection followed by stream resolution reads its iframe only once', async () => {
  const { context, calls } = inspectionFixture(),
    resolver = createTentacl(context);
  const url = 'https://x.tentacl.su/embed/fixture';
  await resolver.loadServers(url, 'https://www.animefox.org/fixture.html');
  const stream = await resolver.resolve(url, 'https://www.animefox.org/fixture.html', 'one');
  assert.equal(stream.variants.length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 1);
  // Inspection is one-shot; later playback must obtain a fresh session.
  await resolver.resolve(url, 'https://www.animefox.org/fixture.html', 'one');
  assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 2);
});

test('Tentacl submits its referer form once and never follows a foreign form action', async () => {
  for (const action of ['/embed/fixture', 'https://foreign.invalid/embed/fixture']) {
    const { context, calls } = inspectionFixture();
    const originalRequest = context.http.request;
    const originalExtract = context.html.extract;
    context.http.request = async (input) => {
      if (input.url.includes('/embed/') && input.method === 'GET') {
        calls.push(input);
        return { body: '<form id="frmValidation"></form>' };
      }
      return originalRequest(input);
    };
    context.html.extract = async (body, query) =>
      query.selector === 'form#frmValidation'
        ? { action, method: 'post' }
        : originalExtract(body, query);
    const resolver = createTentacl(context);
    if (action.startsWith('/')) {
      const result = await resolver.resolve(
        'https://x.tentacl.su/embed/fixture',
        'https://www.animefox.org/fixture.html',
      );
      assert.equal(result.variants.length, 1);
      assert.equal(
        calls.filter((call) => call.url.includes('/embed/') && call.method === 'POST').length,
        1,
      );
    } else {
      await assert.rejects(() => resolver.resolve('https://x.tentacl.su/embed/fixture'));
      assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    }
  }
});

test('Tentacl inspection cannot be reused under another title referer', async () => {
  const { context, calls } = inspectionFixture(),
    resolver = createTentacl(context);
  const url = 'https://x.tentacl.su/embed/fixture';
  await resolver.loadServers(url, 'https://www.animefox.org/first.html');
  await resolver.resolve(url, 'https://www.animefox.org/second.html');
  assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 2);
});

test('Tentacl refreshes expired inspection and ignores a backwards clock', async () => {
  for (const next of [10000, -1]) {
    let clock = 0;
    const { context, calls } = inspectionFixture(),
      resolver = createTentacl(context, { now: () => clock });
    const url = 'https://x.tentacl.su/embed/fixture';
    await resolver.loadServers(url, 'https://www.animefox.org/fixture.html');
    clock = next;
    await resolver.resolve(url, 'https://www.animefox.org/fixture.html');
    assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 2);
  }
});

test('AnimeFox provider selection reuses only the matching inspected episode payload', async () => {
  const { context, calls } = inspectionFixture(),
    source = createSource(context);
  const url =
    'https://www.animefox.org/embed/123/?series=1&referer=https%3A%2F%2Fwww.animefox.org%2Ffixture.html';
  const groups = await source.loadPlaybackGroups({ url });
  const selected = groups.find((group) => group.playerId === 'animefox:one');
  assert.ok(selected);
  const stream = await source.resolveStream({ url: selected.episodes[0].url });
  assert.equal(stream.variants.length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/index.php?')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 1);
});

test('AnimeFox fetches a new payload when the selected episode changes', async () => {
  const { context, calls } = inspectionFixture(),
    source = createSource(context);
  const first = 'https://www.animefox.org/embed/123/?series=1';
  await source.loadPlaybackGroups({ url: first });
  await source.resolveStream({ url: 'https://www.animefox.org/embed/123/?series=2' });
  assert.equal(calls.filter((call) => call.url.includes('/index.php?')).length, 2);
  // Even an unchanged iframe URL can now represent another episode/session.
  assert.equal(calls.filter((call) => call.url.includes('/embed/')).length, 2);
});

test('playlist expansion is parallel with a limit of three and keeps quality order', async () => {
  const { context } = inspectionFixture({ multiplePlaylists: true });
  const original = context.http.request;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let active = 0,
    peak = 0,
    started = 0;
  context.http.request = async (input) => {
    if (!input.url.includes('/hls/')) return original(input);
    started++;
    active++;
    peak = Math.max(peak, active);
    await gate;
    active--;
    return { body: '#EXTM3U\n#EXTINF:10,\nsegment.ts\n' };
  };
  const result = createTentacl(context).resolve('https://x.tentacl.su/embed/fixture');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 3);
  release();
  const stream = await result;
  assert.equal(peak, 3);
  assert.equal(started, 4);
  assert.deepEqual(
    stream.variants.map((variant) => variant.quality),
    ['720', '480', '360', '240'],
  );
});
