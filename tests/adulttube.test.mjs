import test from 'node:test';
import assert from 'node:assert/strict';
import createSource, { streamVariants } from '../sources/adulttube/src/index.mjs';
import manifest from '../sources/adulttube/manifest.json' with { type: 'json' };

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
