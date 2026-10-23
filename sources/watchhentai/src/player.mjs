import { text, array, first, dedupe, base64Bytes, base64Text, fail } from '../../../sdk/video.mjs';
import { parseLiteral, literalProperty } from '../../../sdk/literal.mjs';
export const isLocalPlayer = (uri, origin) =>
  uri.origin === origin &&
  (uri.pathname === '/jwplayer/' ||
    uri.pathname === '/plyr/' ||
    uri.pathname.startsWith('/player/') ||
    uri.pathname.startsWith('/player-alt/'));
const quality = (value) =>
  /(?:_|\/)(\d{3,4})p?(?:\.|\/)/.exec(new URL(value).pathname)?.[1] ?? 'auto';
const mime = (value) =>
  new URL(value).pathname.toLowerCase().endsWith('.m3u8')
    ? 'application/vnd.apple.mpegurl'
    : 'video/mp4';
export function decodeMediaUrl(value) {
  value = text(value);
  if (/^https:\/\//.test(value)) return value;
  try {
    const bytes = base64Bytes(value.replace(/-/g, '+').replace(/_/g, '/')),
      transformed = Array.from(bytes, (v, index) => v ^ (13 + (index % 17))).reverse();
    const nested = String.fromCharCode(...transformed);
    return base64Text(nested);
  } catch {
    return '';
  }
}
function preferred(rows) {
  rows = dedupe(rows, (v) => `${v.url}|${v.quality}|${v.mimeType}`);
  const max = Math.max(0, ...rows.map((v) => Number(v.quality) || 0));
  return rows.map((v) => ({ ...v, isPreferred: (Number(v.quality) || 0) === max }));
}
export function queryVariants(uri, headers) {
  const raw = text(uri.searchParams.get('source'));
  if (!/^https:\/\//.test(raw)) return [];
  const source = new URL(raw),
    qualities = text(uri.searchParams.get('quality'))
      .split(',')
      .map((v) => /\d{3,4}/.exec(v)?.[0])
      .filter(Boolean);
  if (!qualities.length)
    return [
      {
        url: source.href,
        quality: quality(source.href),
        mimeType: mime(source.href),
        headers,
        isPreferred: true,
      },
    ];
  const extension = source.pathname.endsWith('.m3u8') ? '.m3u8' : '.mp4',
    base = source.pathname.endsWith(extension)
      ? source.pathname.slice(0, -extension.length)
      : source.pathname;
  return preferred(
    qualities.map((q) => {
      const uri = new URL(source);
      uri.pathname = `${base}_${q}p${extension}`;
      return { url: uri.href, quality: q, mimeType: mime(uri.href), headers };
    }),
  );
}
export function htmlVariants(html, headers) {
  const rows = [];
  for (const match of html.matchAll(/var\s+wh(?:Jw|Vjs)Sources\s*=\s*/gi))
    for (const value of array(parseLiteral(html, match.index + match[0].length))) {
      const url = decodeMediaUrl(value.file);
      if (/^https:\/\//.test(url))
        rows.push({
          url,
          quality: /\d{3,4}/.exec(text(value.label))?.[0] ?? quality(url),
          mimeType: mime(url),
          headers,
        });
    }
  for (const value of array(literalProperty(html, 'sources'))) {
    const url = first(value.file, value.src);
    if (/^https:\/\//.test(url))
      rows.push({
        url,
        quality: /\d{3,4}/.exec(first(value.label, value.size))?.[0] ?? quality(url),
        mimeType: mime(url),
        headers,
      });
  }
  // Legacy standalone JWPlayer source objects need not be inside a sources list.
  for (const match of html.matchAll(
    /(?:file|src)\s*:\s*(["'])(.*?)\1[\s\S]{0,240}?(?:label|size)\s*:\s*["']?(\d{3,4})p?/gi,
  )) {
    const url = parseLiteral(match[0], match[0].indexOf(match[1]));
    if (/^https:\/\//.test(url))
      rows.push({ url, quality: match[3], mimeType: mime(url), headers });
  }
  if (!rows.length) {
    const url = literalProperty(html, 'contentUrl');
    if (typeof url === 'string' && /^https:\/\//.test(url))
      rows.push({ url, quality: quality(url), mimeType: mime(url), headers });
  }
  return preferred(rows);
}
export function createPlayer(context) {
  async function get(url, referer) {
    return text(
      (
        await context.http.request({
          method: 'GET',
          url,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: {
            Referer: referer,
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
          },
        })
      ).body,
    );
  }
  return async ({ url }) => {
    const input = new URL(url),
      base = (await context.settings.network()).baseUrl || context.baseUrl,
      origin = new URL(base).origin;
    if (
      input.origin !== origin ||
      !(input.pathname.startsWith('/videos/') || isLocalPlayer(input, origin))
    )
      throw fail('Unsupported WatchHentai URL');
    let players = [input];
    if (input.pathname.startsWith('/videos/')) {
      const html = await get(url, origin + '/'),
        frames = array(
          await context.html.extract(html, {
            selector: 'iframe',
            all: true,
            fields: {
              primary: { attr: 'data-primary-player-url' },
              alternate: { attr: 'data-alternate-player-url' },
              src: { attr: 'src' },
              lazy: { attr: 'data-src' },
            },
          }),
        );
      players = dedupe(
        frames
          .flatMap((frame) => [frame.primary, frame.alternate, frame.src, frame.lazy])
          .map(text)
          .filter(Boolean)
          .map((value) => new URL(value, origin))
          .filter((uri) => isLocalPlayer(uri, origin)),
        (v) => v.href,
      );
    }
    for (const uri of players) {
      const headers = { Referer: uri.href, Origin: origin },
        fromQuery = queryVariants(uri, headers);
      if (fromQuery.length) return { variants: fromQuery };
      try {
        const rows = htmlVariants(await get(uri.href, url), headers);
        if (rows.length) return { variants: rows };
      } catch (error) {
        if (
          ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
            error?.code,
          )
        )
          throw error;
      }
    }
    throw fail('WatchHentai player has no playable streams', 'stream_unavailable');
  };
}
