import test from 'node:test';
import assert from 'node:assert/strict';
import { isSite, sitePath } from '../sources/porno365/src/index.mjs';
test('Porno365 rotating site path parser rejects unrelated hosts and invalid title paths', () => {
  assert.equal(isSite('mirror-porno365.media'), true);
  assert.equal(isSite('porno365evil.example'), false);
  assert.equal(sitePath('http://4porno365.run/movie/49572', /^\/movie\/\d+$/), '/movie/49572');
  assert.equal(sitePath('https://example.org/movie/49572', /^\/movie\/\d+$/), '');
  assert.equal(sitePath('/movie/not-a-number', /^\/movie\/\d+$/), '');
  assert.equal(sitePath(undefined, /^\/[^/]+$/), '');
});
