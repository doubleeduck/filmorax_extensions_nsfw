import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { literalProperty } from '../../../sdk/literal.mjs';
import { filters, catalogRequest } from './filters.mjs';
const validId = (value) => (/^[A-Za-z0-9_-]{3,128}$/.test(text(value)) ? text(value) : '');
const imageWidth = (url) => {
  try {
    const width = Number(/_(\d+)\.(?:jpe?g|png|webp)$/i.exec(new URL(url).pathname)?.[1]);
    return width > 0 && width <= 8192 ? width : null;
  } catch {
    return null;
  }
};
const itemId = (value) =>
  validId(value.startsWith('eporner-') ? decodeURIComponent(value.slice(8)) : value);
const urlId = (value) => {
  try {
    const uri = new URL(value, 'https://www.eporner.com');
    return validId(
      uri.pathname.startsWith('/video-')
        ? uri.pathname.split('/')[1].slice(6)
        : /^\/(?:embed|hd-porn)\//.test(uri.pathname)
          ? uri.pathname.split('/')[2]
          : '',
    );
  } catch {
    return '';
  }
};
const cardFields = {
  url: { selector: 'a[href*="/video-"]', attr: 'href' },
  title: { selector: '.mbtit', text: true },
  image: {
    selector: 'img',
    fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
  },
  duration: { selector: '.mbtim', text: true },
  views: { selector: '.mbvie', text: true },
  quality: { selector: '.mvhdico', text: true },
  rating: { selector: '.mbrate', text: true },
};
const duration = (value) => {
  const parts = text(value).split(':');
  return !parts.length || parts.length > 3 || parts.some((v) => !/^\d+$/.test(v))
    ? null
    : parts.reduce((sum, v) => sum * 60 + Number(v), 0);
};
const formatDuration = (value) => {
  if (value == null) return '';
  const m = Math.floor(value / 60),
    s = String(value % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const formatViews = (value) =>
  !value || value < 0
    ? ''
    : value >= 1e6
      ? `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M views`
      : value >= 1000
        ? `${(value / 1000).toFixed(value >= 1e4 ? 0 : 1)}K views`
        : `${value} views`;
function groups(id, title, seconds) {
  return [
    {
      id: `${id}-eporner`,
      playerId: 'eporner',
      playerLabel: 'Eporner',
      title: 'Eporner',
      subtitle: 'Direct MP4 / HLS',
      episodes: [
        {
          id: `${id}-video`,
          title,
          number: '1',
          url: 'eporner://video?id=' + encodeURIComponent(itemId(id)),
          durationSeconds: seconds,
        },
      ],
    },
  ];
}
function card(row, origin) {
  const id = urlId(row.url),
    title = first(row.title, row.image?.alt);
  if (!id || !title) return null;
  const image = first(row.image?.lazy, row.image?.src),
    poster = image ? new URL(image, origin).href : '',
    quality = text(row.quality);
  return {
    id: 'eporner-' + id,
    title,
    kind: 'movie',
    subtitle: [row.duration, row.views].map(text).filter(Boolean).join(' / '),
    rating: Math.max(
      0,
      Math.min(
        10,
        (Number(/\d+(?:[.,]\d+)?/.exec(text(row.rating))?.[0].replace(',', '.')) || 0) / 10,
      ),
    ),
    posterUrl: poster,
    posterWidth: imageWidth(poster),
    backdropUrl: poster,
    isNsfw: true,
    tags: quality ? [quality] : [],
    playbackGroups: groups('eporner-' + id, title, duration(row.duration)),
  };
}
function jsonVideos(scripts) {
  const results = [];
  for (const script of scripts) {
    try {
      const value = JSON.parse(script),
        rows = Array.isArray(value) ? value : [value, ...array(value?.['@graph'])];
      for (const row of rows)
        if (array(row?.['@type']).includes('VideoObject') || row?.['@type'] === 'VideoObject')
          results.push(object(row));
    } catch {}
  }
  return results;
}
export const compactHash = (value) => {
  const hash = text(value);
  return /^[0-9a-f]{32}$/i.test(hash)
    ? [0, 8, 16, 24].map((i) => parseInt(hash.slice(i, i + 8), 16).toString(36)).join('')
    : '';
};
export function streamVariants(payload, headers) {
  const variants = [];
  for (const [group, formats] of Object.entries(object(payload?.sources)))
    for (const [key, row] of Object.entries(object(formats))) {
      const url = text(row.src);
      if (!/^https:\/\//.test(url)) continue;
      const path = new URL(url).pathname,
        mime = first(
          row.type,
          group === 'hls' || path.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : group === 'mp4' || path.endsWith('.mp4')
              ? 'video/mp4'
              : '',
        );
      if (
        ![
          'video/mp4',
          'application/vnd.apple.mpegurl',
          'application/x-mpegURL',
          'application/dash+xml',
        ].includes(mime)
      )
        continue;
      variants.push({
        url,
        quality: /\d{3,4}/.exec(first(row.labelShort, key))?.[0] ?? 'auto',
        mimeType: mime,
        headers,
        isPreferred: row.default === true,
      });
    }
  return dedupe(variants, (v) => v.url);
}
export default function createSource(context) {
  const origin = async () =>
    new URL((await context.settings.network()).baseUrl || context.baseUrl).origin;
  async function get(url, referer, type = 'text', xhr = false) {
    const uri = new URL(url);
    return (
      await context.http.request({
        method: 'GET',
        url,
        responseType: type,
        userAgentProfile: 'browser',
        headers: {
          Accept: xhr ? 'application/json, text/plain, */*' : 'text/html',
          'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
          Referer: referer || uri.origin + '/',
          Origin: uri.origin,
          ...(xhr ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
        },
      })
    ).body;
  }
  async function search(args = {}) {
    const base = await origin(),
      request = catalogRequest(args),
      url = new URL(base + request.path);
    for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value);
    const html = text(await get(url.href)),
      data = object(
        await context.html.extract(html, {
          fields: {
            primary: {
              selector: '#vidresults',
              fields: { cards: { selector: 'div.mb', all: true, fields: cardFields } },
            },
            all: { selector: 'div.mb', all: true, fields: cardFields },
            next: { selector: 'link[rel~="next"]', attr: 'href' },
          },
        }),
      );
    return {
      items: dedupe(
        (data.primary ? array(data.primary.cards) : array(data.all))
          .map((row) => card(row, base))
          .filter(Boolean),
        (v) => v.id,
      ).slice(0, 200),
      hasMore: Boolean(text(data.next)),
    };
  }
  async function loadDetails({ itemId: raw }) {
    const id = itemId(raw);
    if (!id) return null;
    const base = await origin(),
      html = text(await get(`${base}/video-${id}/`)),
      data = object(
        await context.html.extract(html, {
          fields: {
            json: {
              selector: 'script[type="application/ld+json"]',
              all: true,
              text: true,
              normalizeWhitespace: false,
            },
            related: { selector: '#relateddiv div.mb', all: true, fields: cardFields },
          },
        }),
      );
    const video = jsonVideos(array(data.json)).find((v) =>
      [v.url, v.embedUrl, v.contentUrl].some((url) => urlId(text(url)) === id),
    );
    if (!video || !text(video.name)) return null;
    const title = text(video.name),
      match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(text(video.duration)),
      seconds = match
        ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) || null
        : null,
      tags = dedupe(
        text(video.description)
          .split(',')
          .map(text)
          .filter((v) => v.length > 1 && v.length <= 80),
        (v) => v.toLowerCase(),
      ).slice(0, 18),
      poster = first(
        ...array(video.thumbnailUrl),
        typeof video.thumbnailUrl === 'string' ? video.thumbnailUrl : '',
        ...array(video.image),
        typeof video.image === 'string' ? video.image : '',
      ),
      views =
        Number(
          (Array.isArray(video.interactionStatistic)
            ? video.interactionStatistic.find((v) => v.userInteractionCount != null)
            : video.interactionStatistic
          )?.userInteractionCount,
        ) || 0,
      rawRating = Number(video.aggregateRating?.ratingValue) || 0;
    return {
      id: raw,
      webUrl: new URL('/hd-porn/' + encodeURIComponent(id) + '/', base).href,
      title,
      kind: 'movie',
      subtitle: [formatDuration(seconds), formatViews(views)].filter(Boolean).join(' / '),
      overview: tags.join(', '),
      rating: Math.max(0, Math.min(10, rawRating > 10 ? rawRating / 10 : rawRating)),
      year: Number(/(?:19|20)\d{2}/.exec(text(video.uploadDate))?.[0]) || null,
      posterUrl: poster,
      posterWidth: imageWidth(poster),
      backdropUrl: poster,
      isNsfw: true,
      tags,
      metadata: tags.map((value) => ({ kind: 'tag', labelKey: 'media.metadata.tag', value })),
      playbackGroups: groups(raw, title, seconds),
      relatedItems: dedupe(
        array(data.related)
          .map((row) => card(row, base))
          .filter((v) => v && v.id !== raw),
        (v) => v.id,
      ).slice(0, 48),
    };
  }
  async function resolveStream({ url }) {
    const uri = new URL(url),
      id =
        uri.protocol === 'eporner:' && uri.hostname === 'video'
          ? validId(uri.searchParams.get('id'))
          : urlId(url);
    if (!id) throw fail('Invalid Eporner URL');
    const base = uri.protocol === 'https:' ? uri.origin : await origin(),
      embed = `${base}/embed/${id}/`,
      html = text(await get(embed)),
      headers = { Referer: embed, Origin: base },
      hash = compactHash(
        /(?:EP\.video\.player\.)?hash\s*[:=]\s*["']([\da-f]{32})["']/i.exec(html)?.[1] ?? '',
      );
    if (hash) {
      try {
        const xhr = new URL(`${base}/xhr/video/${id}`);
        for (const [key, value] of Object.entries({
          hash,
          device: 'generic',
          domain: new URL(base).hostname,
          fallback: 'false',
        }))
          xhr.searchParams.set(key, value);
        const variants = streamVariants(await get(xhr.href, embed, 'json', true), headers);
        if (variants.length) return { variants };
      } catch (error) {
        if (
          ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
            error?.code,
          )
        )
          throw error;
      }
    }
    const fallback = literalProperty(html, 'contentUrl');
    if (typeof fallback === 'string' && /^https:\/\//.test(fallback)) {
      const path = new URL(fallback).pathname;
      return {
        variants: [
          {
            url: fallback,
            quality: /(?:^|[-_/])(\d{3,4})p?(?:[-_.]|$)/.exec(path)?.[1] ?? 'auto',
            mimeType: path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
            headers,
            isPreferred: true,
          },
        ],
      };
    }
    throw fail('Eporner player has no playable streams', 'stream_unavailable');
  }
  return {
    getFilters: () => filters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 }) => search({ page, selectedFilters: { sort: ['top-weekly'] } }),
    getLatest: ({ page = 1 }) => search({ page }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
