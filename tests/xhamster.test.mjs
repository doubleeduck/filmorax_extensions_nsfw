import test from 'node:test';
import assert from 'node:assert/strict';
import { decipherUrl } from '../sources/xhamster/src/decipher.mjs';
import { nativeVariants, sitePath } from '../sources/xhamster/src/index.mjs';
test('xHamster decrypts current native URL and keeps H264 HLS without duplicate codecs or blocked MP4', () => {
  const vector =
    '072fe2213e3f660483e05f517428b6f1769655d44a99ad0278debdce882098ea5311b7a57baa269c20431265a27525f6b034abf78f9559fa478bbc560e6a34541978f24555c4b81cee8e1ee397ac74e434aba42f5be47a98bbd125345700ec7b439449f10c973a46ffd490c0b670ae4d546abdd4ad4cf785e224cccadcce3aaf20b762bd6e4929b471c1e43e4c388ff33b2de83de5a3757f14497f93e88b5ceed9e6ab7590cfcd82afb326448e87f64a56b522b020baa3ba559a06c3';
  const url = decipherUrl(vector);
  assert.equal(new URL(url).hostname.endsWith('.xhcdn.com'), true);
  assert.equal(new URL(url).pathname.endsWith('.m3u8'), true);
  const result = nativeVariants(
    {
      xplayerSettings: {
        sources: {
          hls: { av1: { url: 'https://video-h.xhcdn.com/av1.m3u8' }, h264: { url: vector } },
          standard: {
            h264: [
              {
                quality: '720p',
                url: 'https://video-h.xhcdn.com/key=bad,limit=3/speed=0/720p.mp4',
              },
            ],
          },
        },
      },
    },
    {},
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].url, url);
  assert.equal(result[0].quality, 'auto');
  assert.equal(sitePath('https://ads.example/videos/example-1'), '');
  assert.equal(sitePath('/categories/drama', true), '/categories/drama');
});
