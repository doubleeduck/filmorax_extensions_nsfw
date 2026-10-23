import { readFile, lstat } from 'node:fs/promises';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, verifyPackage } from './package_format.mjs';
import { releaseSignatureDomain } from './release.mjs';
import { validateRepositoryInventory } from './repository_config.mjs';

/** Independent verification before publishing: no private key is needed. */
export async function verifyReleaseDirectory({ directory, config, fingerprint, version }) {
  const publicRecord = JSON.parse(await readFile(join(directory, 'publisher.public.json'), 'utf8'));
  const rawKey = Buffer.from(publicRecord.publicKey ?? '', 'base64');
  if (
    rawKey.length !== 32 ||
    createHash('sha256').update(rawKey).digest('hex') !== fingerprint ||
    publicRecord.keyId !== config.publisherKeyId
  )
    throw Error('Release publisher fingerprint/key ID mismatch');
  const bytes = await readFile(join(directory, 'release.json'));
  if (bytes.length > 512 * 1024) throw Error('Oversized release inventory');
  const catalog = JSON.parse(bytes.toString('utf8'));
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
    format: 'der',
    type: 'spki',
  });
  if (
    catalog.schemaVersion !== 1 ||
    catalog.publisherKeyId !== publicRecord.keyId ||
    catalog.channel !== config.channel ||
    canonicalJson(catalog) !== bytes.toString() ||
    !Array.isArray(catalog.packages) ||
    catalog.packages.length > 128 ||
    !verify(
      null,
      Buffer.concat([releaseSignatureDomain, bytes]),
      key,
      await readFile(join(directory, 'release.ed25519')),
    )
  )
    throw Error('Release inventory signature or channel mismatch');
  const sources = new Set(),
    features = new Set(),
    ids = new Set();
  const files = [
    'release.json',
    'release.ed25519',
    'publisher.public.json',
    'publisher.fingerprint.txt',
  ];
  for (const entry of catalog.packages) {
    if (
      !/^[a-z0-9][a-z0-9_.-]*\.fxextension$/u.test(entry.file ?? '') ||
      !Number.isInteger(entry.size) ||
      entry.size < 22 ||
      entry.size > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? '') ||
      ids.has(entry.id)
    )
      throw Error('Invalid release package entry');
    const target = join(directory, entry.file),
      stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size)
      throw Error('Release package must be an exact regular archive file');
    const archive = await readFile(target);
    if (
      archive.length !== entry.size ||
      createHash('sha256').update(archive).digest('hex') !== entry.sha256
    )
      throw Error('Release archive checksum mismatch');
    const manifest = verifyPackage(archive, rawKey);
    const sameIds = (a, b) =>
      Array.isArray(a) && canonicalJson([...a].sort()) === canonicalJson([...b].sort());
    if (
      manifest.id !== entry.id ||
      manifest.version !== entry.version ||
      manifest.publisherKeyId !== publicRecord.keyId ||
      (version && manifest.version !== version) ||
      (manifest.sources.length &&
        manifest.sources.some((s) => s.isNsfw) !== (config.channel === 'nsfw')) ||
      entry.name !== manifest.name ||
      entry.isNsfw !== manifest.sources.some((s) => s.isNsfw) ||
      !sameIds(
        entry.sourceIds,
        manifest.sources.map((s) => s.id),
      ) ||
      !sameIds(entry.hostFeatures, manifest.contributions.hostFeatures)
    )
      throw Error('Release package identity/version/classification mismatch');
    ids.add(manifest.id);
    for (const source of manifest.sources) {
      if (sources.has(source.id)) throw Error('Duplicate released source');
      sources.add(source.id);
    }
    for (const feature of manifest.contributions.hostFeatures) features.add(feature);
    if (
      (await readFile(join(directory, `${entry.file}.sha256`), 'utf8')) !==
      `${entry.sha256}  ${entry.file}\n`
    )
      throw Error('Detached checksum differs from signed inventory');
    files.push(entry.file, `${entry.file}.sha256`);
  }
  validateRepositoryInventory(config, sources, features);
  if (
    !Array.isArray(publicRecord.extensionIds) ||
    publicRecord.extensionIds.length !== ids.size ||
    !publicRecord.extensionIds.every((id) => ids.has(id)) ||
    !Array.isArray(publicRecord.hostFeatures) ||
    publicRecord.hostFeatures.length !== features.size ||
    !publicRecord.hostFeatures.every((id) => features.has(id)) ||
    (await readFile(join(directory, 'publisher.fingerprint.txt'), 'utf8')).trim() !== fingerprint
  )
    throw Error('Public record grants differ from released packages');
  return { catalog, files };
}
