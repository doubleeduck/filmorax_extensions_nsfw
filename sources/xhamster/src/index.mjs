import { text, array, object, first, dedupe, fail, jsonObjectAfter } from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';
import { decipherUrl } from './decipher.mjs';
const isSite = (host) =>
  ['xhamster.com', 'xhamster.one', 'xhamster.desi', 'xhms.pro', 'xhday.com', 'xhvid.com'].some(
    (v) => host === v || host.endsWith('.' + v),
  ) || /^xhamster\d+\.(?:com|desi)$/.test(host);
export function sitePath(value, category = false) {
  if (!text(value)) return '';
  try {
    const uri = new URL(value, 'https://xhamster.com'),
      path = uri.pathname.replace(/\/+$/, '');
    return isSite(uri.hostname) &&
      (category ? /^\/categories\/[^/]+$/ : /^\/(?:videos|movies)\/[^/]+$/).test(path)
      ? path
      : '';
  } catch {
    return '';
  }
}
const titleFromPath = (path) =>
  path
    .split('/')
    .at(-1)
    .replace(/-[a-zA-Z0-9]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
const sprite = (value) => text(value).replace(/\.s\.(?:webp|jpe?g)(?=\?|$)/i, '.webp');
const srcset = (value) =>
  text(value)
    .split(/,\s+(?=\S)/)[0]
    .split(/\s+/)[0];
const meta = (name) => ({
  selector: `meta[property="${name}"],meta[name="${name}"]`,
  attr: 'content',
});
const cardFields = {
  url: { attr: 'href' },
  title: { attr: 'title' },
  aria: { attr: 'aria-label' },
  html: { outerHtml: true },
  image: {
    selector: 'img',
    fields: {
      lazy: { attr: 'data-src' },
      src: { attr: 'src' },
      srcset: { attr: 'srcset' },
      lazyset: { attr: 'data-srcset' },
      alt: { attr: 'alt' },
      title: { attr: 'title' },
    },
  },
  sprite: { selector: '[data-sprite]', attr: 'data-sprite' },
  poster: { selector: 'video', attr: 'poster' },
  duration: { selector: '[class*="duration"],[class*="time"]', text: true },
  parentDuration: {
    ascend: 1,
    fields: { value: { selector: '[class*="duration"],[class*="time"]', text: true } },
  },
};
function initials(html) {
  return jsonObjectAfter(html, 'window.initials') ?? {};
}
function posterMap(value) {
  const result = new Map(),
    pending = [value];
  let nodes = 0;
  while (pending.length && nodes++ < 50000) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const path = sitePath(first(current.pageURL, current.link)),
      poster = first(
        current.thumbURL,
        current.previewThumbURL,
        current.imageURL,
        sprite(current.spriteURL),
      );
    if (path && poster) result.set(path, poster);
    pending.push(...Object.values(current));
  }
  return result;
}
const absolute = (value, base) =>
  text(value) && !text(value).startsWith('data:') ? new URL(value, base).href : '';
const tagsFromTitle = (value) =>
  value
    .split(/[,/|]/)
    .map(text)
    .filter((v) => v.length > 2)
    .slice(0, 4);
const formatDuration = (seconds) => {
  const m = Math.floor(seconds / 60),
    s = String(seconds % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
function cards(rows, base, posters, exclude = '') {
  return dedupe(
    rows
      .map((row) => {
        const path = sitePath(row.url);
        if (
          !path ||
          /(?:class|data-role|aria-label|title)\s*=\s*["'][^"']*(?:\bpaid\b|\bpremium\b|crown)|data-(?:paid|premium)\s*=\s*["']?(?:1|true|yes)|<(?:svg|use)\b[^>]*(?:crown|premium|paid)/i.test(
            row.html,
          )
        )
          return null;
        const title = first(
            row.title,
            row.aria,
            row.image?.alt,
            row.image?.title,
            titleFromPath(path),
          ),
          poster = absolute(
            first(
              row.image?.lazy,
              srcset(row.image?.srcset),
              srcset(row.image?.lazyset),
              posters.get(path),
              row.image?.src,
              sprite(row.sprite),
              row.poster,
            ),
            base,
          );
        return {
          id: 'xhamster-' + encodeURIComponent(path),
          webUrl: new URL(path, base).href,
          title,
          kind: 'movie',
          subtitle: first(row.duration, row.parentDuration?.value),
          posterUrl: poster,
          backdropUrl: poster,
          isNsfw: true,
          tags: tagsFromTitle(title),
        };
      })
      .filter((v) => v && v.id !== exclude),
    (v) => v.id,
  );
}
export function nativeVariants(data, headers, page) {
  const video = object(data.videoModel),
    sources = object(data.xplayerSettings?.sources),
    variants = [];
  const add = (raw, hint = '', preferred = false) => {
    try {
      const value = decipherUrl(raw);
      if (!text(value)) return;
      const uri = new URL(value, page),
        blocked =
          uri.hostname.endsWith('.xhcdn.com') &&
          uri.href.includes('.mp4') &&
          (uri.href.includes('limit=') || uri.href.includes('/speed=0/'));
      if (
        uri.protocol !== 'https:' ||
        blocked ||
        !/\.(?:mp4|m3u8)$/.test(uri.pathname.toLowerCase())
      )
        return;
      variants.push({
        url: uri.href,
        quality:
          /\d{3,4}/.exec(text(hint))?.[0] ??
          /(?:_|\/|-)(\d{3,4})p?(?:[_.-]|\.)/.exec(uri.pathname)?.[1] ??
          'auto',
        mimeType: uri.pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        headers,
        isPreferred: preferred,
      });
    } catch {}
  };
  const hls = object(sources.hls),
    groups = 'url' in hls || 'fallback' in hls ? [['', hls]] : Object.entries(hls),
    priority = (name) => ({ h264: 0, '': 1, vp9: 2, av1: 3 })[name.toLowerCase()] ?? 4;
  groups.sort(([a], [b]) => priority(a) - priority(b));
  for (const [, group] of groups) {
    add(group?.url, 'auto', true);
    if (!variants.length) add(group?.fallback, 'auto', true);
    if (variants.length) return variants;
  }
  for (const [codec, formats] of Object.entries(object(video.sources)))
    if (['h264', 'av1', 'vp9'].includes(codec.toLowerCase()))
      for (const [quality, url] of Object.entries(object(formats)))
        if (typeof url === 'string') add(url, quality);
  for (const [codec, rows] of Object.entries(object(sources.standard)))
    if (['h264', 'av1', 'vp9'].includes(codec.toLowerCase()))
      for (const row of array(rows)) {
        add(row.url, first(row.quality, row.label));
        add(row.fallback, first(row.quality, row.label));
      }
  const unique = dedupe(variants, (v) => `${v.url}:${v.quality}`),
    max = Math.max(0, ...unique.map((v) => Number(v.quality) || 0));
  return unique
    .map((v) => ({
      ...v,
      isPreferred: unique.length === 1 || (max > 0 && Number(v.quality) === max),
    }))
    .sort(
      (a, b) =>
        Number(b.isPreferred) - Number(a.isPreferred) ||
        (Number(b.quality) || 0) - (Number(a.quality) || 0),
    );
}
export default function createSource(context) {
  const origin = async () =>
    ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  let categories;
  async function get(path, params = {}) {
    const base = await origin(),
      url = new URL(path, base + '/');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return {
      base,
      url: url.href,
      html: text(
        (
          await context.http.request({
            method: 'GET',
            url: url.href,
            responseType: 'text',
            userAgentProfile: 'browser',
            headers: {
              Accept: 'text/html',
              'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
              Referer: base + '/',
              Origin: base,
            },
          })
        ).body,
      ),
    };
  }
  async function getFilters({ refresh = false } = {}) {
    if (!categories || refresh) {
      try {
        const { html } = await get('/categories'),
          rows = array(
            await context.html.extract(html, {
              selector: 'a[href*="/categories/"]',
              all: true,
              fields: { url: { attr: 'href' }, name: { text: true }, title: { attr: 'title' } },
            }),
          );
        categories = dedupe(
          rows
            .map((row) => ({
              value: sitePath(row.url, true),
              label: first(row.name, row.title, titleFromPath(row.url)),
            }))
            .filter((v) => v.value && v.label && v.label.toLowerCase() !== 'all categories'),
          (v) => v.value,
        );
      } catch (error) {
        if (['permission_denied', 'cancelled', 'auth_session_changed'].includes(error?.code))
          throw error;
        categories = [];
      }
      if (!categories.length)
        categories = [
          'amateur',
          'mature',
          'lesbian',
          'anal',
          'homemade',
          'milf',
          'hentai',
          'pov',
          'blowjob',
          'bdsm',
        ].map((value) => ({
          value: '/categories/' + value,
          label:
            value === 'milf' || value === 'bdsm' || value === 'pov'
              ? value.toUpperCase()
              : value[0].toUpperCase() + value.slice(1),
        }));
    }
    return [
      {
        id: 'category',
        title: 'source_filter.genre',
        kind: 'singleSelect',
        options: [{ value: '', label: 'source_filter.any' }, ...categories],
      },
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        defaultValues: ['relevance'],
        options: ['relevance', 'views', 'rating', 'date', 'duration'].map((value) => ({
          value,
          label:
            value === 'duration'
              ? 'Duration'
              : `source_filter.sort.${value === 'date' ? 'update_date' : value}`,
        })),
      },
    ];
  }
  async function catalog(path, params = {}) {
    const { base, html } = await get(path, params),
      rows = array(
        await context.html.extract(html, {
          selector: 'a[href*="/videos/"],a[href*="/movies/"]',
          all: true,
          fields: cardFields,
        }),
      ),
      items = cards(rows, base, posterMap(initials(html))).slice(0, 36);
    return { items, hasMore: items.length >= 36 };
  }
  function paged(path, page) {
    return path + (page > 1 ? '/' + page : '');
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const term = text(searchTerm),
      f = selectedFilters;
    if (!term) return catalog(paged(sitePath(f.category?.[0], true) || '/best/weekly', page));
    const params = {
      ...(page > 1 ? { page } : {}),
      ...(text(f.sort?.[0]) && f.sort[0] !== 'relevance' ? { sort: f.sort[0] } : {}),
    };
    return catalog('/search/' + encodeURIComponent(term), params);
  }
  async function loadDetails({ itemId }) {
    const path = sitePath(
      decodeURIComponent(itemId.startsWith('xhamster-') ? itemId.slice(9) : itemId),
    );
    if (!path) return null;
    const { base, html } = await get(path),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: meta('og:title'),
            heading: { selector: 'h1', text: true },
            image: meta('og:image'),
            poster: { selector: 'video', attr: 'poster' },
            duration: meta('video:duration'),
            overview: meta('og:description'),
            related: {
              selector: 'a[href*="/videos/"],a[href*="/movies/"]',
              all: true,
              fields: cardFields,
            },
          },
        }),
      ),
      initial = initials(html),
      video = object(initial.videoModel),
      title = first(
        video.title,
        text(data.title).replace(/\s*-\s*xHamster.*$/i, ''),
        data.heading,
        titleFromPath(path),
      ),
      poster = absolute(first(video.thumbURL, video.thumbnail, data.image, data.poster), base),
      seconds = Number(video.duration ?? data.duration) || null,
      tags = dedupe(
        array(video.categories)
          .map((v) => text(v.name))
          .filter(Boolean),
        (v) => v,
      );
    return {
      id: 'xhamster-' + encodeURIComponent(path),
      webUrl: new URL(path, base).href,
      title,
      kind: 'movie',
      subtitle: [seconds ? formatDuration(seconds) : '', ...tags.slice(0, 2)]
        .filter(Boolean)
        .join(' / '),
      overview: first(video.description, data.overview),
      posterUrl: poster,
      backdropUrl: poster,
      isNsfw: true,
      tags: tags.length ? tags : tagsFromTitle(title),
      metadata: tags.map((value) => ({
        kind: 'genre',
        labelKey: 'metadata.genre',
        value,
        filterId: 'tag',
        filterValue: value,
      })),
      playbackGroups: [
        {
          id: `${itemId}-xhamster`,
          playerId: 'xhamster',
          playerLabel: 'xHamster',
          title: 'xHamster',
          subtitle: 'xPlayer',
          episodes: [
            {
              id: `${itemId}-video`,
              title,
              number: '1',
              url: base + path,
              durationSeconds: seconds,
            },
          ],
        },
      ],
      relatedItems: cards(array(data.related), base, posterMap(initial), itemId).slice(0, 12),
    };
  }
  async function resolveStream({ url }) {
    const path = sitePath(url);
    if (!path) throw fail('Unsupported xHamster URL');
    const { html } = await get(url),
      uri = new URL(url),
      headers = { Referer: url, Origin: uri.origin };
    let variants = nativeVariants(initials(html), headers, url);
    if (!variants.length) {
      const data = object(
        await context.html.extract(html, {
          fields: {
            sources: { selector: 'video[src],source[src]', all: true, attr: 'src' },
            meta: {
              selector:
                'meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]',
              all: true,
              attr: 'content',
            },
          },
        }),
      );
      const match = /\bsources\s*=\s*/.exec(html),
        legacy = match ? object(parseLiteral(html, match.index + match[0].length)) : {};
      const values = { ...legacy };
      for (const [index, value] of [...array(data.sources), ...array(data.meta)].entries())
        values['source-' + index] = value;
      variants = nativeVariants({ videoModel: { sources: { h264: values } } }, headers, url);
    }
    if (!variants.length)
      throw fail('xHamster player has no playable streams', 'stream_unavailable');
    return { variants };
  }
  return {
    getFilters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 }) => catalog(paged('/best/weekly', page)),
    getLatest: ({ page = 1 }) => catalog(paged('/newest', page)),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
