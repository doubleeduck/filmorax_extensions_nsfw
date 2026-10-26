import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/adulttube/src/index.mjs';
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
});
