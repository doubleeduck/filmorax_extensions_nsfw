import test from 'node:test';
import assert from 'node:assert/strict';
import { createKodik, decodeKodik } from '../resolvers/kodik.mjs';
test('Kodik finds Caesar shift and rejects decoded non-URLs', () => {
  const decoded = decodeKodik(
    'iPZ0kPU6Tg9rHO4cHFppjFJaHA50HFV0T3HxHODdThU2UK5bkLY6iOfhWu1pjutuHFV0Tu0hlBo',
  );
  assert.equal(decoded.shift, 8);
  assert.equal(decoded.url, 'https://cdn.example.test/video/360.mp4:hls:manifest.m3u8');
  assert.equal(decodeKodik('//cdn.example.test/720.m3u8').url, 'https://cdn.example.test/720.m3u8');
  assert.throws(() => decodeKodik(Buffer.from('not a URL').toString('base64')));
});
test('Kodik keeps signed request fields, endpoint caching and real quality URLs', async () => {
  let scriptCalls = 0,
    apiCalls = 0;
  const resolver = createKodik({
    http: {
      request: async (input) => {
        const url = new URL(input.url);
        let body;
        if (url.pathname === '/assets/js/app.player.js') {
          scriptCalls++;
          body = '$.ajax({url:atob("L2Z0b3I=")})';
        } else if (url.pathname === '/ftor') {
          apiCalls++;
          const form = new URLSearchParams(input.body);
          assert.equal(form.get('d_sign'), 'signed');
          assert.equal(form.get('type'), 'seria');
          assert.equal(form.get('id'), '123');
          body = {
            links: {
              360: [{ src: '//cloud.kodik-storage.com/360.m3u8' }],
              720: [{ src: '//cloud.kodik-storage.com/other-720.m3u8' }],
            },
          };
        } else
          body =
            '<script src="/assets/js/app.player.js"></script><script>var domain="kodikplayer.com";var d_sign="signed";v.type="seria";v.id="123";v.hash="hash";</script>';
        return { body };
      },
    },
  });
  const url = 'https://kodikplayer.com/seria/123/hash/720p';
  const result = await resolver(url);
  await resolver(url);
  assert.equal(scriptCalls, 1);
  assert.equal(apiCalls, 2);
  assert.equal(result.variants[1].url, 'https://cloud.kodik-storage.com/other-720.m3u8');
  assert.equal(result.variants[0].mimeType, 'application/vnd.apple.mpegurl');
});
