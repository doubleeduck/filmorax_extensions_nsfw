import test from 'node:test';
import assert from 'node:assert/strict';
import createSource, { searchUrl, streamVariants } from '../sources/adulttube/src/index.mjs';
import manifest from '../sources/adulttube/manifest.json' with { type: 'json' };

test('AdultTube media session stays scoped to its CDN without a blank sign-in page', () => {
  const source = manifest.sources[0];
  assert.ok(manifest.permissions.includes('sourceSession'));
  assert.equal(source.capabilities.includes('auth'), false);
  assert.deepEqual(source.network.authOrigins, ['https://cdn.noodlemagazine.com']);
  assert.deepEqual(source.network.browserMediaOrigins, ['https://cdn.noodlemagazine.com']);
  assert.equal(source.web, undefined);
  assert.equal(source.network.userAgentProfile, 'browser');
  assert.ok(source.network.origins.includes('https://cdn.noodlemagazine.com'));
  for (const origin of ['https://vkuserphoto.ru', 'https://okcdn.ru']) {
    assert.ok(source.network.imageOrigins.includes(origin));
    assert.equal(source.network.authOrigins.includes(origin), false);
    assert.equal(source.network.browserMediaOrigins.includes(origin), false);
  }
  assert.equal(source.network.allowSubdomains, true);
});

test('AdultTube uses adult search for empty queries and catalogue calls', async () => {
  assert.ok(manifest.sources[0].capabilities.includes('catalog'));
  const requests = [];
  const source = createSource({
    baseUrl: 'https://hot.mat6tube.com',
    settings: { network: async () => ({ baseUrl: '' }) },
    http: {
      request: async (request) => {
        requests.push(request);
        return { body: '<div class="item"></div>' };
      },
    },
    html: {
      extract: async (_html, query) =>
        query.fields?.cards
          ? {
              cards: [
                {
                  url: '/watch/123_456',
                  title: 'Example title',
                  image: { src: '/poster.jpg' },
                },
              ],
              more: 'Show more',
            }
          : '',
    },
  });

  for (const run of [() => source.search(), () => source.getPopular(), () => source.getLatest()]) {
    const result = await run();
    assert.equal(result.items.length, 1);
    assert.equal(result.hasMore, true);
    assert.equal(new URL(requests.at(-1).url).pathname, '/video/adult');
  }
  assert.equal(new URL(requests.at(-1).url).searchParams.get('sort'), '0');
  await source.search({ searchTerm: 'custom query' });
  assert.equal(new URL(requests.at(-1).url).pathname, '/video/custom%20query');
  assert.equal('Origin' in requests.at(-1).headers, false);
});

test('AdultTube native CDN streams omit page headers and retain signed URLs', async () => {
  const streamUrl = 'https://cdn.noodlemagazine.com/videos/1/2/vid_480p.mp4?secure=token';
  const result = await streamVariants(
    { html: { extract: async () => ({ embed: '' }) } },
    `window.playlist = {sources: [{file: '${streamUrl}', label: '480', type: 'mp4'}]};`,
    { Referer: 'https://hot.mat6tube.com/' },
  );
  assert.equal(result.variants[0].url, streamUrl);
  assert.equal(result.variants[0].refreshBeforePlay, true);
  assert.equal(result.variants[0].mimeType, 'video/mp4');
  assert.deepEqual(result.variants[0].headers, {});
  assert.equal(manifest.sources[0].presentation.imageHeaders.Referer, 'https://hot.mat6tube.com/');
});

test('AdultTube delegates protected media to the host without blocking it with a native HEAD', async () => {
  const playlist =
    'window.playlist = {sources: [{file: "https://cdn.noodlemagazine.com/videos/1/2/vid_480p.mp4?secure=token", label: "480", type: "mp4"}]};';
  const requests = [];
  const source = createSource({
    baseUrl: 'https://hot.mat6tube.com',
    settings: { network: async () => ({ baseUrl: '' }) },
    html: { extract: async () => ({}) },
    http: {
      request: async (request) => {
        requests.push(request);
        if (request.method === 'HEAD') {
          throw Object.assign(new Error('Cloudflare'), { code: 'challenge_required' });
        }
        return { body: playlist };
      },
    },
  });
  const args = { url: 'https://hot.mat6tube.com/watch/1_2' };
  assert.equal((await source.resolveStream(args)).variants.length, 1);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['GET'],
  );
});

function searchFixture({ rows = 2, more = '', csrf = 'fixture-token', redirect = '', image } = {}) {
  const requests = [];
  let serial = 0;
  const source = createSource({
    baseUrl: 'https://hot.mat6tube.com',
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => {
        requests.push(input);
        return { body: `page-${++serial}`, url: redirect || input.url };
      },
    },
    html: {
      extract: async (_html, query) => {
        if (query.attr === 'value') return csrf;
        return {
          cards: Array.from({ length: rows }, (_, i) => ({
            url: `/watch/123_${i}`,
            title: 'Fixture',
            image: image || { src: '/poster.jpg' },
          })),
          more,
        };
      },
    },
  });
  return { source, requests };
}

test('search URL preserves literal query characters and the actual site filters', () => {
  const term = '  видео + test & # / 100%  ';
  const url = searchUrl('https://hot.mat6tube.com', {
    searchTerm: term,
    selectedFilters: { sort: ['0'], len: ['short'], hd: ['true'] },
  });
  assert.equal(decodeURIComponent(url.pathname.slice('/video/'.length)), term.trim());
  assert.equal(url.hash, '');
  assert.deepEqual(Object.fromEntries(url.searchParams), { sort: '0', len: 'short', hd: '1' });
  assert.equal(
    searchUrl('https://mirror.example/prefix/', { searchTerm: 'test' }).pathname,
    '/prefix/video/test',
  );
  assert.equal(
    searchUrl('https://hot.mat6tube.com', { searchTerm: '   ' }).pathname,
    '/video/adult',
  );
  assert.equal(
    searchUrl('https://hot.mat6tube.com', {
      selectedFilters: { sort: ['stale'], len: ['bad'], hd: ['false'] },
    }).search,
    '',
  );
  assert.throws(() => searchUrl('https://hot.mat6tube.com', { searchTerm: 'x'.repeat(2049) }), {
    code: 'invalid_argument',
  });
});

test('HD and duration are real search-capable controls, not fabricated catalogue categories', () => {
  const { source } = searchFixture();
  const filters = source.getFilters();
  assert.deepEqual(
    filters.map((row) => row.id),
    ['sort', 'len', 'hd'],
  );
  assert.deepEqual(
    filters.find((row) => row.id === 'len').options.map((row) => row.value),
    ['any', 'short', 'long'],
  );
  assert.equal(filters.find((row) => row.id === 'hd').kind, 'toggle');
  assert(filters.every((row) => row.isAvailableWithSearchTerm));
});

test('catalogue entry points preserve the supplied search term and selected filters', async () => {
  const { source, requests } = searchFixture();
  await source.getPopular({
    searchTerm: 'test query',
    selectedFilters: { len: ['long'], hd: ['true'] },
  });
  const popular = new URL(requests.at(-1).url);
  assert.equal(decodeURIComponent(popular.pathname), '/video/test query');
  assert.equal(popular.searchParams.get('hd'), '1');
  assert.equal(popular.searchParams.get('len'), 'long');
  await source.getLatest({ searchTerm: 'test query', selectedFilters: { hd: ['true'] } });
  const latest = new URL(requests.at(-1).url);
  assert.equal(decodeURIComponent(latest.pathname), '/video/test query');
  assert.equal(latest.searchParams.get('sort'), '0');
  assert.equal(latest.searchParams.get('hd'), '1');
});

test('paged search bootstraps CSRF then repeats every filter in the form body', async () => {
  const { source, requests } = searchFixture();
  await source.search({
    page: 3,
    searchTerm: 'test',
    selectedFilters: { sort: ['1'], len: ['long'], hd: ['true'] },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'GET');
  const post = requests[1];
  assert.equal(post.method, 'POST');
  assert.equal(post.headers['X-CSRFToken'], 'fixture-token');
  assert.equal(post.headers.Origin, 'https://hot.mat6tube.com');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(post.body)), {
    sort: '1',
    len: 'long',
    hd: '1',
    csrfmiddlewaretoken: 'fixture-token',
    p: '2',
  });
  assert(requests.every((request) => !('Cookie' in request.headers)));
});

test('missing CSRF does not send an unauthenticated pagination request', async () => {
  const { source, requests } = searchFixture({ csrf: '' });
  await assert.rejects(source.search({ page: 2 }), { code: 'parse_error' });
  assert.equal(requests.length, 1);
});

test('redirected search posts to its final endpoint and resolves posters there', async () => {
  const { source, requests } = searchFixture({
    redirect: 'https://wow.mat6tube.com/video/test',
    image: { src: 'poster.jpg' },
  });
  const page = await source.search({ searchTerm: 'test', page: 2 });
  assert.equal(requests[1].url, 'https://wow.mat6tube.com/video/test');
  assert.equal(requests[1].headers.Origin, 'https://wow.mat6tube.com');
  assert.equal(page.items[0].posterUrl, 'https://wow.mat6tube.com/video/poster.jpg');
  assert.equal(page.items[0].webUrl, 'https://wow.mat6tube.com/watch/123_0');
});

test('empty final pages stop pagination and inline image placeholders use the site fallback', async () => {
  const empty = searchFixture({ rows: 0, more: '3' });
  assert.equal((await empty.source.search()).hasMore, false);
  const last = searchFixture({ rows: 2 });
  assert.equal((await last.source.search()).hasMore, false);
  const full = searchFixture({ rows: 24 });
  assert.equal((await full.source.search()).hasMore, true);
  const preview = searchFixture({
    image: { src: 'data:image/gif;base64,AAAA', fallback: '//cdn.noodlemagazine.com/poster.jpg' },
  });
  const page = await preview.source.search();
  assert.equal(page.items[0].posterUrl, 'https://cdn.noodlemagazine.com/poster.jpg');
});

test('canonical mirror watch URLs remain natively resolvable after a search redirect', async () => {
  const requests = [];
  const source = createSource({
    baseUrl: 'https://hot.mat6tube.com',
    settings: { network: async () => ({}) },
    html: { extract: async () => ({}) },
    http: {
      request: async (input) => {
        requests.push(input);
        return {
          body: 'window.playlist = {sources: [{file:"https://cdn.noodlemagazine.com/video.mp4?secure=fixture",label:"480",type:"mp4"}]};',
        };
      },
    },
  });
  assert.equal(
    (await source.resolveStream({ url: 'https://wow.mat6tube.com/watch/1_2' })).variants.length,
    1,
  );
  await assert.rejects(
    source.resolveStream({ url: 'https://mat6tube.com.evil.example/watch/1_2' }),
  );
  await assert.rejects(
    source.resolveStream({ url: 'https://user:password@hot.mat6tube.com/watch/1_2' }),
  );
  assert.equal(requests.length, 1);
});
