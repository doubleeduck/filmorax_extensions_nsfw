import test from 'node:test';
import assert from 'node:assert/strict';
import createSource, { isSite, sitePath } from '../sources/porno365/src/index.mjs';
import manifest from '../sources/porno365/manifest.json' with { type: 'json' };
test('Porno365 rotating site path parser rejects unrelated hosts and invalid title paths', () => {
  assert.equal(isSite('mirror-porno365.media'), true);
  assert.equal(isSite('porno365evil.example'), false);
  assert.equal(sitePath('http://4porno365.run/movie/49572', /^\/movie\/\d+$/), '/movie/49572');
  assert.equal(sitePath('https://example.org/movie/49572', /^\/movie\/\d+$/), '');
  assert.equal(sitePath('/movie/not-a-number', /^\/movie\/\d+$/), '');
  assert.equal(sitePath(undefined, /^\/[^/]+$/), '');
});

test('Porno365 uses the requested mirror and follows a labelled next-page link', async () => {
  const definition = manifest.sources[0],
    requests = [],
    source = createSource({
      baseUrl: definition.baseUrl,
      settings: { network: async () => ({ baseUrl: '' }) },
      http: {
        request: async (request) => {
          requests.push(request.url);
          return { url: request.url, body: '<main></main>' };
        },
      },
      html: {
        extract: async (_html, query) =>
          query.fields?.cards
            ? {
                cards: [
                  {
                    url: 'http://4porno365.fun/movie/51016',
                    title: 'Example title',
                    image: { src: 'https://pic.vidb365.com/poster.webp' },
                  },
                ],
                next: [{ url: 'http://4porno365.fun/2', label: 'Показать еще' }],
              }
            : [],
      },
    });
  assert.equal(definition.baseUrl, 'https://t.porno365.golf');
  assert.ok(definition.network.origins.includes(definition.baseUrl));
  const result = await source.getLatest();
  assert.equal(requests[0], 'https://t.porno365.golf/');
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, true);
});

test('Porno365 keeps the observed HTTP mirror and rejects unrelated redirects', async () => {
  const requested = [];
  const source = createSource({
    baseUrl: 'https://t.porno365.golf',
    settings: { network: async () => ({ baseUrl: '' }) },
    http: {
      request: async (request) => {
        requested.push(request.url);
        return { url: 'http://4porno365.fun/', body: '<main></main>' };
      },
    },
    html: { extract: async () => ({ cards: [], next: [] }) },
  });
  await source.search();
  await source.search();
  assert.equal(requested[1], 'http://4porno365.fun/');

  const unrelated = createSource({
    baseUrl: 'https://t.porno365.golf',
    settings: { network: async () => ({ baseUrl: '' }) },
    http: {
      request: async () => ({ url: 'http://other-porno365.fun/', body: '' }),
    },
  });
  await assert.rejects(unrelated.search(), (error) => error.code === 'network');
});

test('Porno365 reads the current JWPlayer MP4 source format', async () => {
  let requested;
  const source = createSource({
    baseUrl: 'https://t.porno365.golf',
    settings: { network: async () => ({ baseUrl: '' }) },
    http: {
      request: async (request) => {
        requested = request.url;
        return {
          body: 'jwplayer("player_div").setup({sources: [{file: "https://vid7.vide365.com/porno365/ff_1080p10/51016.mp4?st=token", label: "1080p FullHD", "default": true}]});',
        };
      },
    },
    html: { extract: async () => ({}) },
  });
  const result = await source.resolveStream({ url: 'http://4porno365.fun/movie/51016' });
  assert.equal(requested, 'http://4porno365.fun/movie/51016');
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].quality, '1080');
  assert.equal(result.variants[0].mimeType, 'video/mp4');
});
