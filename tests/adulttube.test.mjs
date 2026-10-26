import test from 'node:test';
import assert from 'node:assert/strict';
import createSource, { streamVariants } from '../sources/adulttube/src/index.mjs';
import manifest from '../sources/adulttube/manifest.json' with { type: 'json' };

test('AdultTube browser session is scoped only to the protected media CDN', () => {
  const source = manifest.sources[0];
  assert.ok(manifest.permissions.includes('sourceSession'));
  assert.ok(source.capabilities.includes('auth'));
  assert.deepEqual(source.network.authOrigins, ['https://cdn.noodlemagazine.com']);
  assert.deepEqual(source.web.cookieOrigins, ['https://cdn.noodlemagazine.com']);
  assert.equal(source.web.loginUrl, 'https://cdn.noodlemagazine.com/');
  assert.equal(source.network.userAgentProfile, 'browser');
  assert.ok(source.network.origins.includes('https://cdn.noodlemagazine.com'));
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

test('AdultTube checks CDN access before returning native variants and reports its challenge', async () => {
  const playlist =
    'window.playlist = {sources: [{file: "https://cdn.noodlemagazine.com/videos/1/2/vid_480p.mp4?secure=token", label: "480", type: "mp4"}]};';
  const requests = [];
  let cdnError = Object.assign(new Error('HTTP 403'), {
    code: 'challenge_required',
    httpStatus: 403,
  });
  const source = createSource({
    baseUrl: 'https://hot.mat6tube.com',
    settings: { network: async () => ({ baseUrl: '' }) },
    html: { extract: async () => ({}) },
    http: {
      request: async (request) => {
        requests.push(request);
        if (request.method === 'HEAD') {
          if (cdnError) throw cdnError;
          return { status: 200, body: [], headers: { 'content-type': 'video/mp4' } };
        }
        return { body: playlist };
      },
    },
  });
  const args = { url: 'https://hot.mat6tube.com/watch/1_2' };
  await assert.rejects(source.resolveStream(args), (error) => {
    assert.equal(error.code, 'challenge_required');
    assert.equal(error.httpStatus, 403);
    assert.equal(error.phase, 'http');
    return true;
  });
  assert.equal(requests.at(-1).method, 'HEAD');
  assert.equal(requests.at(-1).userAgentProfile, 'browser');

  cdnError = null;
  assert.equal((await source.resolveStream(args)).variants.length, 1);

  cdnError = Object.assign(new Error('Denied'), { code: 'permission_denied' });
  await assert.rejects(source.resolveStream(args), (error) => error === cdnError);
});
