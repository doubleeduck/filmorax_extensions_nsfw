import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMediaUrl,
  htmlVariants,
  queryVariants,
  isLocalPlayer,
} from '../sources/watchhentai/src/player.mjs';
const encode = (value) =>
  Buffer.from(
    [...Buffer.from(Buffer.from(value).toString('base64')).reverse()].map(
      (byte, index) => byte ^ (13 + (index % 17)),
    ),
  ).toString('base64url');
test('WatchHentai decodes current source envelopes and preserves legacy configurations', () => {
  const url = 'https://hstorage.xyz/fixture_1080p.mp4?token=test';
  assert.equal(decodeMediaUrl(encode(url)), url);
  assert.equal(decodeMediaUrl('not-valid'), '');
  const variants = htmlVariants(`var whJwSources = [{"file":"${encode(url)}","label":"1080p"}];`, {
    Referer: 'https://watchhentai.net/player/1',
  });
  assert.equal(variants.length, 1);
  assert.equal(variants[0].url, url);
  assert.equal(variants[0].isPreferred, true);
  assert.equal(
    htmlVariants('setup({sources:[{file:"https://hstorage.xyz/a.mp4",label:"720p"}]});', {})[0]
      .quality,
    '720',
  );
});
test('WatchHentai quality URL expansion keeps signatures and only uses local player frames', () => {
  const uri = new URL('https://watchhentai.net/jwplayer/');
  uri.searchParams.set('source', 'https://hstorage.xyz/fixture.mp4?token=test');
  uri.searchParams.set('quality', '720,1080');
  const variants = queryVariants(uri, {});
  assert.equal(variants[0].url, 'https://hstorage.xyz/fixture_720p.mp4?token=test');
  assert.equal(variants[1].isPreferred, true);
  assert.equal(
    isLocalPlayer(new URL('https://ads.example/player/1'), 'https://watchhentai.net'),
    false,
  );
});
