import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  releaseVersion,
  resolveReleaseVersion,
  ed25519PrivateKey,
} from '../tools/release_version.mjs';

test('release versions cannot inject shell arguments, hide leading zeros or disagree with a tag', () => {
  for (const value of ['1.2.3', '0.1.0', '1.2.3-rc.1']) assert.equal(releaseVersion(value), value);
  for (const value of [
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0+other',
    '1.0.0-01',
    '9223372036854775808.0.0',
    '1.99999999999999999999999.0',
    '--help',
    '1.0.0; echo private',
    '1.0.0\n',
    '../tag',
    '',
    null,
  ])
    assert.throws(() => releaseVersion(value));
  assert.equal(resolveReleaseVersion({ refType: 'tag', refName: 'v1.2.3' }), '1.2.3');
  assert.equal(resolveReleaseVersion({ requestedVersion: '1.2.3' }), '1.2.3');
  assert.throws(() =>
    resolveReleaseVersion({ requestedVersion: '1.2.4', refType: 'tag', refName: 'v1.2.3' }),
  );
  assert.throws(() => resolveReleaseVersion({ refType: 'branch', refName: 'main' }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  assert.equal(ed25519PrivateKey(privateKey), privateKey);
  assert.throws(() => ed25519PrivateKey(publicKey));
});
