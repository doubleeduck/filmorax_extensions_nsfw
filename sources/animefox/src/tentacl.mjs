import {
  text,
  array,
  object,
  first,
  dedupe,
  fail,
  base64Text,
  base64Bytes,
  base64FromBytes,
  hlsVariants,
} from '../../../sdk/video.mjs';
import { decodeSettings } from './aa.mjs';
const signedSecret = 'V8xK2mP9qR4wT6yA3bN7cJ5dF1gH0eL';
const critical = (error) =>
  ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
    error?.code,
  );
const quality = (path) => /(\d{3,4})p/.exec(path)?.[1] ?? 'source';
export async function decryptResponse(context, value, password) {
  value = text(value);
  if (value.startsWith('{')) return value;
  let bytes;
  for (const transformed of [
    value.replace(/-/g, '+').replace(/_/g, '/').replace(/,/g, '='),
    value.replace(/-/g, '/').replace(/_/g, '+').replace(/,/g, '='),
    value.replace(/,/g, '='),
  ]) {
    try {
      bytes = base64Bytes(transformed);
      break;
    } catch {}
  }
  if (!bytes || bytes.length <= 16) throw fail('Invalid encrypted player response');
  const derived = base64Bytes(
    await context.crypto.pbkdf2Sha256({
      password,
      salt: base64FromBytes(bytes.slice(0, 16)),
      iterations: 10000,
      length: 48,
    }),
  );
  return context.crypto.aesCbcDecrypt({
    key: base64FromBytes(derived.slice(0, 32)),
    iv: base64FromBytes(derived.slice(32, 48)),
    ciphertext: base64FromBytes(bytes.slice(16)),
  });
}
export function createTentacl(context) {
  const getHeaders = (referer, origin = '') => ({
    Accept: '*/*',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: referer,
    ...(origin ? { Origin: origin } : {}),
  });
  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    return text(
      (
        await context.http.request({
          method,
          url,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers,
          ...(body == null ? {} : { body }),
        })
      ).body,
    );
  }
  async function page(url, referer, validate = false) {
    return request(url, {
      method: validate ? 'POST' : 'GET',
      body: validate ? new URLSearchParams({ referer: referer || url }).toString() : null,
      headers: {
        ...getHeaders(referer || url),
        ...(validate ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
  }
  async function servers(html, url) {
    const embed = new URL(url),
      rows = array(
        await context.html.extract(html, {
          selector: '#servers button[data-host][data-url]',
          all: true,
          fields: {
            id: { attr: 'data-host' },
            url: { attr: 'data-url' },
            title: { text: true },
            classes: { attr: 'class' },
          },
        }),
      );
    return dedupe(
      rows
        .map((row) => {
          try {
            const uri = new URL(row.url, embed);
            if (
              !text(row.id) ||
              uri.origin !== embed.origin ||
              uri.pathname !== embed.pathname ||
              !/^\d+$/.test(text(uri.searchParams.get('alt')))
            )
              return null;
            return {
              id: text(row.id),
              title: first(row.title, row.id),
              url: uri.href,
              isActive: text(row.classes).split(/\s+/).includes('active'),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
      (v) => v.id,
    ).slice(0, 8);
  }
  async function expand(variant) {
    const uri = new URL(variant.url);
    if (
      !(uri.hostname === 'tentacl.su' || uri.hostname.endsWith('.tentacl.su')) ||
      !variant.mimeType.includes('mpegurl')
    )
      return [variant];
    try {
      const playlist = await request(uri.href, { headers: variant.headers });
      if (playlist.includes('#EXT-X-STREAM-INF'))
        return hlsVariants(playlist, uri.href, variant.headers).map((v) => ({
          ...v,
          isPreferred: false,
        }));
      if (playlist.includes('#EXTINF') || playlist.includes('#EXT-X-TARGETDURATION'))
        return [variant];
      const child = playlist
        .split(/\r?\n/)
        .map(text)
        .find((v) => v && !v.startsWith('#'));
      if (!child) return [variant];
      const target = new URL(child, uri);
      return [
        {
          ...variant,
          url: target.href,
          quality:
            quality(target.pathname) === 'source' ? variant.quality : quality(target.pathname),
        },
      ];
    } catch (error) {
      if (critical(error)) throw error;
      return [variant];
    }
  }
  async function extractPage(url, html) {
    const settings = decodeSettings(html),
      required = (key) => {
        const value = text(settings[key]);
        if (!value) throw fail('Player settings are incomplete');
        return value;
      },
      base = new URL(required('baseURL')),
      api = base64Text(required('apx')),
      qs = required('qsx'),
      body = required('kaken'),
      signed = ['ts', 'nc', 'sg'].every((v) => text(settings[v])),
      password = signed ? signedSecret + required('ts') + required('nc') : required('pd'),
      headers = {
        ...getHeaders(url, signed ? new URL(api).origin : base.origin),
        ...(signed
          ? { 'X-Ts': required('ts'), 'X-Nc': required('nc'), 'X-Sg': required('sg') }
          : {}),
      };
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw fail('Invalid player base URL');
    base.pathname = base.pathname.replace(/\/?$/u, '/');
    const config = new URL(api + qs);
    if (!signed) {
      config.search = '';
      config.searchParams.set('p', required('ps'));
      config.searchParams.set('_', String(Date.now()));
    }
    try {
      await decryptResponse(context, await request(config.href, { headers }), password);
    } catch (error) {
      if (critical(error)) throw error;
    }
    const endpoint = signed
      ? api.replace('-config', '')
      : new URL('api/?p=' + encodeURIComponent(required('ps')), base).href;
    const decoded = object(
        JSON.parse(
          await decryptResponse(
            context,
            await request(endpoint, {
              method: 'POST',
              body,
              headers: { ...headers, 'Content-Type': 'text/plain' },
            }),
            password,
          ),
        ),
      ),
      variants = [];
    for (const source of array(decoded.sources)) {
      if (!text(source.file)) continue;
      const uri = new URL(source.file, base);
      if (uri.protocol !== 'https:') continue;
      variants.push({
        url: uri.href,
        quality: first(source.label, source.quality, quality(uri.pathname)),
        mimeType:
          /hls/i.test(text(source.type)) ||
          uri.pathname.endsWith('.m3u8') ||
          uri.pathname.includes('/hls/')
            ? 'application/vnd.apple.mpegurl'
            : 'video/mp4',
        headers: getHeaders(url, base.origin),
      });
    }
    const expanded = [];
    for (const variant of dedupe(variants, (v) => `${v.quality}:${v.url}`))
      expanded.push(...(await expand(variant)));
    return dedupe(expanded, (v) => `${v.quality}:${v.url}`);
  }
  async function resolve(url, referer, serverId = '') {
    const uri = new URL(url);
    if (
      !uri.pathname.includes('/embed/') &&
      (/\.(?:mp4|m3u8)$/.test(uri.pathname) || uri.pathname.includes('/hls/'))
    )
      return {
        variants: [
          {
            url,
            quality: quality(uri.pathname),
            mimeType: uri.pathname.endsWith('.mp4') ? 'video/mp4' : 'application/vnd.apple.mpegurl',
            headers: getHeaders(url.split('?')[0]),
          },
        ],
      };
    const html = await page(url, referer),
      available = await servers(html, url),
      selected = available.find((v) => v.id === serverId);
    if (serverId && !selected)
      throw fail('Selected player server is unavailable', 'stream_unavailable');
    const candidates = serverId
      ? [selected]
      : [
          { url, isActive: true },
          ...available.filter((v) => !v.isActive && v.url !== url).slice(0, 7),
        ];
    let last;
    for (const candidate of candidates) {
      try {
        const variants = await extractPage(
          candidate.url,
          candidate.isActive ? html : await page(candidate.url, referer, true),
        );
        if (variants.length) return { variants };
      } catch (error) {
        if (critical(error)) throw error;
        last = error;
      }
    }
    throw last ?? fail('Player has no playable files', 'stream_unavailable');
  }
  return { resolve, loadServers: async (url, referer) => servers(await page(url, referer), url) };
}
