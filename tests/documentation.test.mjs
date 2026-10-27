import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pack } from '../tools/pack.mjs';
import { verifyPackage } from '../tools/package_format.mjs';

test('both maintained guides are signed into distributed packages', async () => {
  const docs = new URL('../docs/', import.meta.url);
  assert.deepEqual((await readdir(docs)).sort(), ['extensions.en.md', 'extensions.ru.md']);
  const { privateKey } = generateKeyPairSync('ed25519');
  const result = await pack({
    project: fileURLToPath(new URL('../examples/demo/', import.meta.url)),
    key: privateKey,
    keyId: 'documentation.fixture',
  });
  const manifest = verifyPackage(
    result.archive,
    Buffer.from(result.publicRecord.publicKey, 'base64'),
  );
  for (const language of ['ru', 'en']) {
    const guide = await readFile(new URL(`extensions.${language}.md`, docs), 'utf8');
    assert.ok(guide.includes('triStateMultiSelect') && guide.includes('exclude:school'));
    assert.equal(/flutter|\bdart\b/i.test(guide), false);
    assert.equal(
      manifest.files[`assets/docs/extensions.${language}.md`].size,
      Buffer.byteLength(guide),
    );
  }
});
