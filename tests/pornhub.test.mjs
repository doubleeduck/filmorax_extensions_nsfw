import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/pornhub/src/index.mjs';

const baseUrl = 'https://www.pornhub.com';
const media = [
  {
    format: 'hls',
    quality: '720',
    defaultQuality: true,
    videoUrl: 'https://ev-h.phncdn.com/720.m3u8?token=fixture',
  },
  { format: 'hls', quality: '480', videoUrl: 'https://ev-h.phncdn.com/480.m3u8' },
  { format: 'mp4', videoUrl: '/video/get_media?token=fixture' },
  { format: 'mp4', videoUrl: 'https://unrelated.example/video/get_media' },
  { format: 'hls', videoUrl: 'https://phncdn.com.invalid/123.m3u8' },
];
function fixture(player = {}) {
  const calls = [];
  const source = createSource({
    baseUrl,
    http: {
      request: async ({ url, responseType, headers }) => {
        calls.push({ url: new URL(url), responseType, headers });
        if (responseType === 'json') {
          return {
            body: [
              { quality: '1080p', videoUrl: 'https://ev-h.phncdn.com/file.mp4?token=fixture' },
            ],
          };
        }
        return {
          url,
          body: `var flashvars_123 = ${JSON.stringify({
            video_unavailable: 'false',
            video_duration: 300,
            mediaDefinitions: media,
            ...player,
          })};`,
        };
      },
    },
    html: {
      extract: async (_html, query, url) => {
        if (query.selector?.startsWith('.categoriesListSection'))
          return [
            { id: '17', title: 'Category' },
            { id: '17', title: 'Duplicate' },
          ];
        if (query.fields.related)
          return {
            title: 'Example',
            related: [
              { key: 'phabcdef', title: 'Self' },
              { key: 'ph123456', title: 'Related' },
            ],
          };
        return {
          cards: [
            {
              key: 'phabcdef',
              title: 'Example',
              lazy: 'https://unrelated.example/a.jpg',
              image: '//pix-fl.phncdn.com/approved.jpg',
            },
            { key: 'phabcdef', title: 'Duplicate' },
            { key: '../bad=', title: 'Invalid key' },
          ],
          next: new URL(url).pathname + '?page=3',
        };
      },
    },
  });
  return { source, calls };
}

test('Pornhub catalogue and paged search retain their sorting and validate poster origins', async () => {
  const { source, calls } = fixture();
  const [, category] = await source.getFilters();
  assert.deepEqual(
    category.options.map((option) => option.value),
    ['', '17'],
  );
  await source.search({ selectedFilters: { category: ['17'], sort: ['mv'] } });
  assert.equal(calls.at(-1).url.pathname, '/video');
  assert.equal(calls.at(-1).url.searchParams.get('c'), '17');
  const result = await source.search({
    page: 2,
    searchTerm: 'a + b & c',
    selectedFilters: { sort: ['tr'] },
  });
  const { url } = calls.at(-1);
  assert.equal(url.pathname, '/video/search');
  assert.equal(url.searchParams.get('search'), 'a + b & c');
  assert.equal(url.searchParams.get('o'), 'tr');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].posterUrl, 'https://pix-fl.phncdn.com/approved.jpg');
});

test('Pornhub details and recommendations lead to validated native HLS and MP4', async () => {
  const { source, calls } = fixture();
  const result = await source.loadDetails({ itemId: 'pornhub-phabcdef' });
  const episode = result.playbackGroups[0].episodes[0];
  assert.equal(episode.durationSeconds, 300);
  assert.deepEqual(
    result.relatedItems.map((row) => row.id),
    ['pornhub-ph123456'],
  );
  const { variants } = await source.resolveStream({ url: episode.url });
  assert.deepEqual(
    variants.map((row) => row.quality),
    ['720', '480', '1080'],
  );
  assert.equal(variants[0].headers.Referer, episode.url);
  assert.equal(variants[0].isPreferred, true);
  assert.equal(variants[2].mimeType, 'video/mp4');
  assert.equal(new URL(variants[0].url).searchParams.get('token'), 'fixture');
  assert.deepEqual(
    calls.filter((row) => row.responseType === 'json').map((row) => row.url.origin),
    [baseUrl],
  );
});

test('Pornhub respects unavailable playback and rejects foreign video links', async () => {
  const { source, calls } = fixture({ video_unavailable_country: 'true' });
  await assert.rejects(
    source.resolveStream({ url: 'https://unrelated.example/view_video.php?viewkey=phabcdef' }),
  );
  assert.equal(calls.length, 0);
  const details = await source.loadDetails({ itemId: 'pornhub-phabcdef' });
  assert.deepEqual(details.playbackGroups, []);
  await assert.rejects(source.resolveStream({ url: details.webUrl }), { code: 'access_denied' });
  assert.equal(calls.length, 2);
});
