import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { signedManifest, packageZip, verifyPackage } from './package_format.mjs';
import { releaseVersion } from './release_version.mjs';

export async function pack({ project, key, keyId, version }) {
  const root = path.resolve(project);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (version != null) manifest.version = releaseVersion(version);
  if (
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(manifest.id) ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(keyId)
  )
    throw Error('Invalid package or key ID');
  if (
    manifest.schemaVersion !== 1 ||
    manifest.sourceApiVersion !== 1 ||
    manifest.minRuntimeAbi !== 1
  )
    throw Error('Unsupported extension API');
  if (
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.resolvers) ||
    !Array.isArray(manifest.contributions?.hostFeatures)
  )
    throw Error('Missing contributions');
  const hasJs = manifest.sources.length > 0 || manifest.resolvers.length > 0;
  if (!hasJs && (manifest.entrypoint != null || manifest.permissions?.length))
    throw Error('Feature-only packages cannot execute code');
  const payloads = new Map();
  async function collect(relative) {
    const full = path.join(root, relative),
      stat = await lstat(full);
    if (stat.isSymbolicLink()) throw Error('Symlinks cannot be packaged');
    if (stat.isDirectory()) {
      for (const entry of await readdir(full)) await collect(`${relative}/${entry}`);
    } else {
      if (
        !/^(?:LICENSE|(?:src|assets)\/[a-zA-Z0-9_./-]+\.(?:mjs|js|json|png|jpg|jpeg|webp|txt))$/u.test(
          relative,
        ) ||
        relative.split('/').some((part) => !part || part === '.' || part === '..')
      )
        throw Error('Unsupported payload');
      if (stat.size > 24 * 1024 * 1024) throw Error('Payload exceeds package limit');
      payloads.set(relative, await readFile(full));
    }
  }
  await collect('LICENSE');
  for (const folder of hasJs ? ['src', 'assets'] : ['assets']) {
    try {
      await collect(folder);
    } catch (error) {
      if (error.code !== 'ENOENT' || folder === 'src') throw error;
    }
  }
  if (hasJs && !payloads.has(manifest.entrypoint))
    throw Error('Entrypoint must be a packaged module');
  if (hasJs) {
    // Shared authoring SDK is bundled into the signed module. The installed
    // package never reads files/imports from the developer's filesystem.
    const result = await build({
      absWorkingDir: root,
      entryPoints: [manifest.entrypoint],
      bundle: true,
      write: false,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      charset: 'utf8',
      legalComments: 'inline',
      logLevel: 'silent',
    });
    for (const name of payloads.keys()) if (/\.(?:mjs|js)$/.test(name)) payloads.delete(name);
    payloads.set(manifest.entrypoint, Buffer.from(result.outputFiles[0].contents));
  }
  if (!hasJs && !manifest.contributions.hostFeatures.length) throw Error('Empty extension');
  manifest.publisherKeyId = keyId;
  const signed = signedManifest(manifest, payloads, key);
  const archive = packageZip(
    new Map([
      ['manifest.json', signed.bytes],
      ['signature.ed25519', signed.signature],
      ...payloads,
    ]),
  );
  verifyPackage(archive, signed.publicKey);
  return {
    archive,
    publicRecord: {
      keyId,
      publicKey: signed.publicKey.toString('base64'),
      extensionIds: [manifest.id],
      hostFeatures: manifest.contributions.hostFeatures,
    },
  };
}

async function main(args) {
  const option = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? null : args[at + 1];
  };
  if (args[0] === 'keygen') {
    const destination = option('--private');
    if (!destination) throw Error('Usage: node tools/pack.mjs keygen --private PRIVATE.pem');
    const { privateKey } = generateKeyPairSync('ed25519');
    // Never overwrite an existing signing key; production keys belong outside Git.
    await writeFile(destination, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      flag: 'wx',
      mode: 0o600,
    });
    console.log('New local key written. It is not automatically trusted by FilmoraX.');
    return;
  }
  const project = option('--project'),
    keyPath = option('--key'),
    keyId = option('--key-id'),
    output = option('--output');
  if (!project || !keyPath || !keyId || !output)
    throw Error(
      'Usage: node tools/pack.mjs --project DIR --key PRIVATE.pem --key-id ID --output FILE.fxextension',
    );
  if (!output.endsWith('.fxextension')) throw Error('Output must end with .fxextension');
  const result = await pack({
    project,
    key: await readFile(keyPath),
    keyId,
    version: option('--version'),
  });
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, result.archive, { flag: 'wx' });
  await writeFile(`${output}.public.json`, JSON.stringify(result.publicRecord, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    `${output}.sha256`,
    `${createHash('sha256').update(result.archive).digest('hex')}  ${path.basename(output)}\n`,
    { flag: 'wx' },
  );
  console.log(
    `Created ${output}. Import the public record only after verifying its fingerprint independently.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
