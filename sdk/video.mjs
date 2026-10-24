/** Shared data helpers, not a generic embed/browser player. */
export const text = (value) => (value == null ? '' : String(value).trim());
export const array = (value) => (Array.isArray(value) ? value : []);
export const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const first = (...values) => values.map(text).find(Boolean) ?? '';
export const fail = (message, code = 'parse_error') => Object.assign(new Error(message), { code });
export const dedupe = (rows, key) => {
  const seen = new Set();
  return rows.filter((row) => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
export const queryUrl = (base, path, parameters = {}) => {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(parameters))
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  return url.href;
};
export function base64Bytes(value) {
  const raw = String(value).replace(/\s/g, '').replace(/=+$/, '');
  if (raw.length > 4 * 1024 * 1024 || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(raw))
    throw fail('Invalid base64');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    bytes = [];
  let bits = 0,
    count = 0;
  for (const char of raw) {
    bits = (bits << 6) | alphabet.indexOf(char);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >>> count) & 255);
    }
  }
  return Uint8Array.from(bytes);
}
export const base64Text = (value) =>
  new TextDecoder('utf-8', { fatal: true }).decode(base64Bytes(value));
export function base64FromBytes(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    result = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result.push(
      alphabet[(value >>> 18) & 63] +
        alphabet[(value >>> 12) & 63] +
        (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
        (i + 2 < bytes.length ? alphabet[value & 63] : '='),
    );
  }
  return result.join('');
}
export const base64EncodeText = (value) => base64FromBytes(new TextEncoder().encode(value));
/** Extract a JSON object from script data without eval or a JS interpreter. */
export function jsonObjectAfter(value, marker) {
  const at = value.indexOf(marker),
    start = at < 0 ? -1 : value.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < value.length; i++) {
    const char = value[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        return object(JSON.parse(value.slice(start, i + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}
export function jsonProperty(input, key) {
  const match = new RegExp(
    `(?:["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?)\\s*:\\s*([\\[{])`,
  ).exec(input);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && --depth === 0) {
      try {
        return JSON.parse(input.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
export function hlsVariants(playlist, masterUrl, headers = {}) {
  if (!playlist.trimStart().startsWith('#EXTM3U')) return [];
  const result = [
    {
      quality: 'auto',
      url: masterUrl,
      mimeType: 'application/vnd.apple.mpegurl',
      headers,
      isPreferred: true,
    },
  ];
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const externalAudio = new Set(
    lines
      .filter(
        (line) =>
          line.startsWith('#EXT-X-MEDIA:') &&
          /(?:^|[:,])TYPE=AUDIO(?:,|$)/.test(line) &&
          /(?:^|,)URI="/.test(line),
      )
      .map((line) => /(?:^|,)GROUP-ID="([^"]+)"/.exec(line)?.[1])
      .filter(Boolean),
  );
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    // A video rendition is not a complete stream when its sound lives in a
    // separate AUDIO playlist. Keep the master so native track selection and
    // dubbing are preserved, rather than offering silent fixed resolutions.
    const audioGroup = /(?:^|,)AUDIO="([^"]+)"/.exec(lines[i].slice(18))?.[1];
    if (externalAudio.has(audioGroup)) continue;
    const height = /(?:^|,)RESOLUTION=\d+x(\d+)/.exec(lines[i].slice(18))?.[1];
    const name = /(?:^|,)NAME="?(\d{3,4})p?/.exec(lines[i].slice(18))?.[1];
    let next = i + 1;
    while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
    if (next < lines.length) {
      const url = new URL(lines[next], masterUrl);
      if (url.protocol === 'https:')
        result.push({
          quality: height ?? name ?? 'auto',
          url: url.href,
          mimeType: 'application/vnd.apple.mpegurl',
          headers,
          isPreferred: false,
        });
    }
  }
  return dedupe(result, (row) => `${row.url}|${row.quality}|${row.mimeType}`);
}
