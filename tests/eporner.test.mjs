import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRequest, filters } from '../sources/eporner/src/filters.mjs';
import { compactHash, streamVariants } from '../sources/eporner/src/index.mjs';
test('Eporner keeps all filters, category exclusion precedence and search route ordering', () => {
  assert.equal(filters.find((f) => f.id === 'categories').options.length, 84);
  const request = catalogRequest({
    page: 2,
    searchTerm: 'a title',
    selectedFilters: {
      sort: ['most-popular'],
      production: ['homemade'],
      quality: ['1080'],
      categories: ['include:amateur', '!amateur', 'include:asmr', 'exclude:outdoor'],
      duration_min: ['20'],
      duration_max: ['10'],
    },
  });
  assert.equal(request.path, '/tag/a-title/2/most-viewed/');
  assert.deepEqual(request.query, {
    quality: '1080',
    duration_min: '600',
    duration_max: '1200',
    include: 'asmr',
    exclude: 'amateur,outdoor',
  });
  const unlimited = catalogRequest({
    selectedFilters: {
      duration_min: ['90'],
      duration_max: ['61'],
      sort: ['not-supported'],
      production: ['professional'],
    },
  });
  assert.equal(unlimited.path, '/cat/all/PROD-pro/');
  assert.deepEqual(unlimited.query, { duration_min: '3600' });
});
test('Eporner compacts the exact page hash and retains native quality/MIME variants', () => {
  assert.equal(compactHash('00000001000000020000000300000004'), '1234');
  assert.equal(compactHash('invalid'), '');
  const variants = streamVariants(
    {
      sources: {
        mp4: {
          '720p': { src: 'https://cdn.eporner.com/720.mp4', labelShort: '720p', type: 'video/mp4' },
        },
        hls: { auto: { src: 'https://cdn.eporner.com/master.m3u8' } },
      },
    },
    {},
  );
  assert.equal(variants.length, 2);
  assert.equal(variants[1].mimeType, 'application/vnd.apple.mpegurl');
});
