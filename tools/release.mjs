import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash, createPublicKey, sign } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pack } from './pack.mjs';
import { canonicalJson, verifyPackage } from './package_format.mjs';
import { ed25519PrivateKey, releaseVersion } from './release_version.mjs';
import { readRepositoryConfig, validateRepositoryInventory } from './repository_config.mjs';

export const releaseSignatureDomain = Buffer.from('FilmoraX extension release v1\n');
const sdkRoot = fileURLToPath(new URL('..', import.meta.url));

/** Assemble artifacts only. Never publishes, installs, trusts or creates a key. */
export async function prepareRelease({ key, keyId, output, channel, version, root = sdkRoot }) {
  const config = await readRepositoryConfig(root);
  channel ??= config?.channel ?? 'all';
  if (!['all', 'standard', 'nsfw'].includes(channel) || (config && config.channel !== channel))
    throw Error('Release channel conflicts with repository configuration');
  if (version != null) releaseVersion(version);
  const signingKey = ed25519PrivateKey(key);
  const publicKey = createPublicKey(signingKey)
    .export({ type: 'spki', format: 'der' })
    .subarray(-32);
  const projects = (await readdir(join(root, 'sources'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, 'sources', entry.name));
  if (channel !== 'nsfw') {
    try {
      await readFile(join(root, 'examples/torrserver/manifest.json'));
      projects.push(join(root, 'examples/torrserver'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const artifacts = [],
    packages = [],
    sourceIds = new Set(),
    extensionIds = new Set(),
    features = new Set();
  for (const project of projects.sort()) {
    const declaration = JSON.parse(await readFile(join(project, 'manifest.json'), 'utf8'));
    const nsfw = declaration.sources.some((source) => source.isNsfw);
    if (config && declaration.sources.length && nsfw !== (config.channel === 'nsfw'))
      throw Error('Source classification conflicts with its release repository');
    if ((channel === 'standard' && nsfw) || (channel === 'nsfw' && !nsfw)) continue;
    const packed = await pack({ project, key: signingKey, keyId, version });
    const manifest = verifyPackage(packed.archive, publicKey);
    if (extensionIds.has(manifest.id)) throw Error('Duplicate extension ID');
    extensionIds.add(manifest.id);
    if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(manifest.version))
      throw Error('Invalid release version');
    for (const source of manifest.sources) {
      if (sourceIds.has(source.id)) throw Error('Duplicate source ID');
      sourceIds.add(source.id);
    }
    for (const feature of manifest.contributions.hostFeatures) features.add(feature);
    const file = `${manifest.id}-${manifest.version}.fxextension`;
    const hash = createHash('sha256').update(packed.archive).digest('hex');
    artifacts.push([file, packed.archive], [`${file}.sha256`, `${hash}  ${file}\n`]);
    packages.push({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      file,
      sha256: hash,
      size: packed.archive.length,
      sourceIds: manifest.sources.map((source) => source.id).sort(),
      isNsfw: manifest.sources.some((source) => source.isNsfw),
      hostFeatures: manifest.contributions.hostFeatures,
    });
  }
  validateRepositoryInventory(config, sourceIds, features);
  packages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const publisher = {
    keyId,
    publicKey: publicKey.toString('base64'),
    extensionIds: [...extensionIds].sort(),
    hostFeatures: [...features].sort(),
  };
  const catalog = { schemaVersion: 1, publisherKeyId: keyId, channel, packages };
  const catalogBytes = Buffer.from(canonicalJson(catalog));
  const signature = sign(null, Buffer.concat([releaseSignatureDomain, catalogBytes]), signingKey);
  artifacts.push(
    ['release.json', catalogBytes],
    ['release.ed25519', signature],
    ['publisher.public.json', canonicalJson(publisher) + '\n'],
    ['publisher.fingerprint.txt', createHash('sha256').update(publicKey).digest('hex') + '\n'],
  );
  // A release is immutable. Refuse an existing target, even if it looks empty.
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  for (const [file, bytes] of artifacts) await writeFile(join(target, file), bytes, { flag: 'wx' });
  return { catalog, publisher, sourceCount: sourceIds.size };
}

async function main(args) {
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const keyPath = option('--key'),
    keyId = option('--key-id'),
    output = option('--output');
  if (
    !keyPath ||
    !keyId ||
    !output ||
    args.some(
      (arg) =>
        arg.startsWith('--') &&
        !['--key', '--key-id', '--output', '--channel', '--version'].includes(arg),
    )
  ) {
    throw Error(
      'Usage: node tools/release.mjs --key PRIVATE.pem --key-id ID --output NEW_DIR [--channel standard|nsfw|all] [--version VERSION]',
    );
  }
  const result = await prepareRelease({
    key: await readFile(keyPath),
    keyId,
    output,
    channel: option('--channel'),
    version: option('--version'),
  });
  console.log(
    `Prepared ${result.catalog.packages.length} packages / ${result.sourceCount} sources. Nothing published or trusted.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
