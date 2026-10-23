import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ed25519PrivateKey } from './release_version.mjs';
/** RFC 8785 for already JSON-compatible package metadata (rejects non-finite/unsafe input). */
export function canonicalJson(value) {
  if (typeof value === 'string') {
    // RFC 8785 forbids lone UTF-16 surrogates, including in property names.
    if (!value.isWellFormed()) throw Error('Package metadata contains invalid Unicode.');
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${canonicalJson(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  throw Error('Package metadata must contain bounded JSON data only.');
}
const domain = Buffer.from('FilmoraX extension package v1\n');
export function signedManifest(manifest, payloads, privateKeyPem) {
  const files = {};
  for (const [path, bytes] of [...payloads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    files[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  const bytes = Buffer.from(canonicalJson({ ...manifest, files })),
    key = ed25519PrivateKey(privateKeyPem);
  return {
    bytes,
    signature: sign(null, Buffer.concat([domain, bytes]), key),
    publicKey: createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32),
  };
}
const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
/** Reproducible ZIP: sorted paths, UTF-8, no extras/ZIP64/comments, fixed 1980 date. */
export function packageZip(files) {
  if (files.size > 130)
    throw Error('Package file count exceeds API v1 limit (128 payloads plus manifest/signature).');
  const locals = [],
    central = [];
  let offset = 0,
    total = 0;
  for (const [path, input] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(path) ||
      path.split('/').some((value) => !value || value === '.' || value === '..')
    )
      throw Error('Unsafe payload path.');
    const name = Buffer.from(path),
      bytes = Buffer.from(input),
      compressed = deflateRawSync(bytes, { level: 9 }),
      crc = crc32(bytes);
    total += bytes.length;
    if (total > 24 * 1024 * 1024) throw Error('Unpacked package exceeds API v1 size limit.');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...locals, directory, end]);
  if (archive.length > 8 * 1024 * 1024)
    throw Error('Compressed package exceeds API v1 size limit.');
  return archive;
}
/** Build-tool verification; the app still performs its independent strict ZIP/JCS verification. */
export function verifyPackage(archive, publicKeyBytes) {
  const files = new Map();
  let position = 0;
  while (archive.readUInt32LE(position) === 0x04034b50) {
    const size = archive.readUInt32LE(position + 18),
      length = archive.readUInt16LE(position + 26),
      extra = archive.readUInt16LE(position + 28),
      path = archive.subarray(position + 30, position + 30 + length).toString('utf8');
    const start = position + 30 + length + extra,
      bytes = inflateRawSync(archive.subarray(start, start + size));
    if (
      files.has(path) ||
      bytes.length !== archive.readUInt32LE(position + 22) ||
      crc32(bytes) !== archive.readUInt32LE(position + 14)
    )
      throw Error('ZIP payload verification failed.');
    files.set(path, bytes);
    position = start + size;
  }
  const bytes = files.get('manifest.json'),
    manifest = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(canonicalJson(manifest))))
    throw Error('Manifest is not canonical.');
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKeyBytes]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, Buffer.concat([domain, bytes]), key, files.get('signature.ed25519')))
    throw Error('Invalid package signature.');
  for (const [path, file] of Object.entries(manifest.files)) {
    const content = files.get(path);
    if (
      !content ||
      content.length !== file.size ||
      createHash('sha256').update(content).digest('hex') !== file.sha256
    )
      throw Error('Invalid file digest.');
  }
  if (files.size !== Object.keys(manifest.files).length + 2)
    throw Error('Unexpected archive entry.');
  return manifest;
}
