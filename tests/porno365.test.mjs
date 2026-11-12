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
  assert.ok(definition.network.origins.includes('http://4porno365.fun'));
  assert.ok(manifest.resolvers[0].origins.includes('http://4porno365.fun'));
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
        return { url: 'http://5porno365.fun/', body: '<main></main>' };
      },
    },
    html: { extract: async () => ({ cards: [], next: [] }) },
  });
  await source.search();
  await source.search();
  assert.equal(requested[1], 'http://5porno365.fun/');

  const unrelated = createSource({
    baseUrl: 'https://t.porno365.golf',
    settings: { network: async () => ({ baseUrl: '' }) },
    http: {
      request: async () => ({ url: 'http://unrelated.example/', body: '' }),
    },
  });
  await assert.rejects(unrelated.search(), (error) => error.code === 'network');
});

test('Porno365 uses custom hosts and route prefixes for search, details and saved episodes', async () => {
  let base = 'http://first.example/catalog';
  const calls = [];
  const source = createSource({
    baseUrl: manifest.sources[0].baseUrl,
    settings: { network: async () => ({ baseUrl: base }) },
    http: {
      request: async (input) => {
        calls.push(input);
        return {
          url: input.url,
          body: 'jwplayer("player_div").setup({sources: [{file: "https://vid7.vide365.com/movie.mp4"}]});',
        };
      },
    },
    html: {
      extract: async (_body, query) =>
        query.fields?.cards
          ? {
              cards: [{ url: base + '/movie/42', title: 'Fixture', image: { src: '/cover.jpg' } }],
              next: [{ url: base + '/search/fixture/2' }],
            }
          : { title: 'Fixture' },
    },
  });
  const result = await source.search({ searchTerm: 'fixture' });
  assert.equal(calls[0].url, base + '/search/?q=fixture');
  assert.equal(calls[0].headers.Origin, 'http://first.example');
  assert.equal(result.items[0].webUrl, base + '/movie/42');
  assert.equal(result.hasMore, true);
  await source.search({ searchTerm: 'fixture', page: 2 });
  assert.equal(calls[1].url, base + '/search/fixture/2');
  const item = await source.loadDetails({ itemId: result.items[0].id });
  const episode = item.playbackGroups[0].episodes[0];
  base = 'https://second.example/prefix';
  const stream = await source.resolveStream({ url: episode.url });
  assert.equal(calls.at(-1).url, base + '/movie/42');
  assert.equal(stream.variants[0].headers.Referer, base + '/movie/42');
  await source.resolveStream({
    url: 'porno365://video?url=' + encodeURIComponent('http://4porno365.fun/movie/42'),
  });
  assert.equal(calls.at(-1).url, base + '/movie/42');
});

test('Porno365 re-discovers a rotated HTTP mirror through the configured address', async () => {
  const calls = [],
    base = 'https://entry.example';
  let mirror = 'http://5porno365.fun';
  const source = createSource({
    baseUrl: manifest.sources[0].baseUrl,
    settings: { network: async () => ({ baseUrl: base }) },
    http: {
      request: async (input) => {
        calls.push(input.url);
        if (input.url.startsWith('http://5porno365.fun/') && mirror !== 'http://5porno365.fun')
          throw Object.assign(new Error('Unavailable'), { code: 'network' });
        return { url: mirror + '/', body: '' };
      },
    },
    html: { extract: async () => ({ cards: [] }) },
  });
  await source.search();
  mirror = 'http://6porno365.fun';
  await source.search();
  await source.search();
  assert.deepEqual(calls, [
    base + '/',
    'http://5porno365.fun/',
    base + '/',
    'http://6porno365.fun/',
  ]);
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

test('recommendations contain a playable episode even before details are loaded', async () => {
  const source = createSource({
    baseUrl: 'https://t.porno365.golf',
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => ({
        url: input.url,
        body: 'setup({sources:[{file:"https://vid7.vide365.com/movie.mp4"}]})',
      }),
    },
    html: {
      extract: async (_html, query) =>
        query.fields?.related
          ? {
              title: 'Current',
              related: [{ url: '/movie/42', title: 'Related', image: { src: '/cover.jpg' } }],
            }
          : {},
    },
  });
  const details = await source.loadDetails({ itemId: 'porno365-%2Fmovie%2F1' });
  const related = details.relatedItems[0];
  assert.equal(related.id, 'porno365-%2Fmovie%2F42');
  const episode = related.playbackGroups[0].episodes[0];
  assert.equal(new URL(episode.url).searchParams.get('path'), '/movie/42');
  assert.equal((await source.resolveStream({ url: episode.url })).variants.length, 1);
});
