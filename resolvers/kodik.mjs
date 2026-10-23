import { text, array, object, first, fail, dedupe, base64Text } from '../sdk/video.mjs';
const browserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export function isKodik(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !/\.(?:m3u8|mp4)$/i.test(url.pathname) &&
      (url.hostname.includes('kodik') ||
        /\/(seria|serial|season|video|film)\/\d+\/[a-z0-9]+\/\d{3,4}p/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}
function caesar(value, shift) {
  return value.replace(/[a-z]/gi, (char) => {
    const code = char.charCodeAt(0),
      base = code < 97 ? 65 : 97;
    return String.fromCharCode(base + ((code - base + 26 - shift) % 26));
  });
}
function nativeUrl(value) {
  value = text(value);
  if (value.startsWith('//')) value = 'https:' + value;
  if (!/^https:\/\//.test(value)) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function decodeKodik(value, preferred) {
  const plain = nativeUrl(value);
  if (plain) return { url: plain, shift: 0 };
  const shifts = [
    ...(Number.isInteger(preferred) ? [preferred] : []),
    ...Array.from({ length: 27 }, (_, i) => i),
  ].filter((v, i, a) => a.indexOf(v) === i);
  for (const shift of shifts) {
    try {
      const url = nativeUrl(base64Text(caesar(value, shift)));
      if (url) return { url, shift };
    } catch {}
  }
  throw fail('Provider link cannot be decoded', 'stream_unavailable');
}
export function createKodik(context) {
  const endpoints = new Map();
  let cachedShift;
  const get = async (url) =>
    text(
      (
        await context.http.request({
          method: 'GET',
          url,
          responseType: 'text',
          userAgentProfile: 'browser',
        })
      ).body,
    );
  return async (value) => {
    if (!isKodik(value)) throw fail('Unsupported provider URL', 'stream_unavailable');
    const uri = new URL(value),
      page = await get(uri.href),
      vars = {},
      info = {};
    for (const match of page.matchAll(/var\s+([a-z_]+)\s*=\s*['"]([^'"]*)['"]/gi))
      vars[match[1]] = match[2];
    for (const match of page.matchAll(/\.(type|hash|id)\s*=\s*['"]([^'"]+)['"];?/g))
      info[match[1]] = match[2];
    if (!info.type || !info.id || !info.hash) throw fail('Provider video identity missing');
    let urlParams = {};
    const raw = /var\s+urlParams\s*=\s*(["'])(.*?)\1/is.exec(page)?.[2] ?? vars.urlparams;
    if (raw) {
      try {
        let decoded;
        try {
          decoded = JSON.parse(`"${raw}"`);
        } catch {
          decoded = raw;
        }
        urlParams = object(JSON.parse(decoded));
      } catch {}
    }
    const payload = { ...info, bad_user: 'false', info: '{}', cdn_is_working: 'true' };
    for (const [name, variable] of [
      ['d', 'domain'],
      ['d_sign', 'd_sign'],
      ['pd', 'pd'],
      ['pd_sign', 'pd_sign'],
      ['ref', 'ref'],
      ['ref_sign', 'ref_sign'],
    ]) {
      const value = first(vars[variable], urlParams[name]);
      if (value) payload[name] = value;
    }
    const scripts = [
      ...page.matchAll(/<script\b[^>]*\bsrc=["']([^"']*assets\/js\/[^"']+)["'][^>]*>/gi),
    ].map((m) => m[1]);
    const script = scripts.find((path) => path.toLowerCase().includes('player')) ?? scripts[0];
    if (!script) throw fail('Provider player script missing');
    for (let attempt = 0; attempt < 2; attempt++) {
      let endpoint = endpoints.get(uri.origin);
      if (!endpoint) {
        const scriptText = await get(new URL(script, uri.origin).href),
          encoded = /url\s*:\s*atob\(["']([A-Za-z0-9+/=]+)["']\)/.exec(scriptText)?.[1];
        if (!encoded) throw fail('Provider endpoint missing');
        endpoint = new URL(base64Text(encoded), uri.origin).href;
        if (new URL(endpoint).origin !== uri.origin)
          throw fail('Cross-origin provider endpoint', 'permission_denied');
        endpoints.set(uri.origin, endpoint);
      }
      try {
        const response = object(
          (
            await context.http.request({
              method: 'POST',
              url: endpoint,
              responseType: 'json',
              userAgentProfile: 'browser',
              headers: {
                Origin: uri.origin,
                Referer: uri.href,
                Accept: 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams(payload).toString(),
            })
          ).body,
        );
        const headers = {
            Origin: uri.origin,
            Referer: `${uri.origin}/`,
            'User-Agent': browserAgent,
          },
          variants = [];
        for (const [quality, rows] of Object.entries(object(response.links))) {
          for (const row of array(rows)) {
            if (!quality || !text(row.src)) continue;
            const decoded = decodeKodik(text(row.src), cachedShift);
            cachedShift = decoded.shift;
            const mime = /\.m3u8(?:[?#]|$)/i.test(decoded.url)
              ? 'application/vnd.apple.mpegurl'
              : first(row.type, 'video/mp4');
            variants.push({ quality, url: decoded.url, mimeType: mime, headers });
          }
        }
        if (!variants.length) throw fail('Provider returned no links', 'stream_unavailable');
        return {
          variants: dedupe(variants, (row) => `${row.url}|${row.quality}|${row.mimeType}`),
          subtitleTracks: [],
        };
      } catch (error) {
        if (
          ['permission_denied', 'cancelled', 'auth_session_changed', 'resource_limit'].includes(
            error?.code,
          )
        )
          throw error;
        endpoints.delete(uri.origin);
        if (attempt === 1) throw error;
      }
    }
    throw fail('Provider stream is unavailable', 'stream_unavailable');
  };
}
