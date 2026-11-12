import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { literalProperty } from '../../../sdk/literal.mjs';
export const isSite = (host) => /(?:^|[.-])[a-z0-9-]*porno365(?=[.-]|$)/i.test(host);
function httpUrl(value, base) {
  if (!text(value)) return null;
  try {
    const uri = new URL(value, base);
    if (['http:', 'https:'].includes(uri.protocol) && !uri.username && !uri.password) return uri;
  } catch {
    // A malformed URL is not a catalogue link.
  }
  return null;
}
function isSiteUrl(uri, base) {
  const entry = new URL(base);
  return (
    uri.origin === entry.origin ||
    (uri.hostname === entry.hostname && !uri.port && !entry.port) ||
    isSite(uri.hostname)
  );
}
export function sitePath(value, pattern, base = 'https://t.porno365.golf') {
  const uri = httpUrl(value, base + '/');
  if (!uri || !isSiteUrl(uri, base)) return '';
  try {
    const prefix = decodeURI(new URL(base).pathname).replace(/\/+$/, '');
    let path = decodeURI(uri.pathname).replace(/\/+$/, '') || '/';
    if (prefix && path.startsWith(prefix + '/')) path = path.slice(prefix.length);
    return pattern.test(path) ? path : '';
  } catch {
    return '';
  }
}
const moviePath = (value, base) => sitePath(value, /^\/movie\/\d+$/, base);
const modelPath = (value, base) => {
  const path = sitePath(value, /^\/models\/[\p{L}\p{N}_-]+$/u, base),
    slug = path.split('/').at(-1);
  return !path || /^(?:ru|male|all|sort-by-.*|\d+)$/.test(slug) ? '' : path;
};
const categoryPath = (value, base) => {
  const path = sitePath(value, /^\/[\p{L}\p{N}_-]+$/u, base);
  return ['/categories', '/models', '/search', '/popular', '/toprated'].includes(path.toLowerCase())
    ? ''
    : path;
};
const directPath = (value, base) => {
  const path = sitePath(value, /^\/(?:(?:models|tags)\/)?[^/?#\\]+$/, base);
  return path.includes('..') ? '' : path;
};
const percent = (value) =>
  Math.max(
    0,
    Math.min(10, (Number(/\d+(?:[.,]\d+)?/.exec(text(value))?.[0].replace(',', '.')) || 0) / 10),
  );
const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60),
    s = String(seconds % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`
    : `${minutes}:${s}`;
};
const imageFields = {
  fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
};
const cardFields = {
  url: { selector: 'a.image', attr: 'href' },
  image: { selector: 'img', ...imageFields },
  title: { selector: 'p', text: true },
  duration: { selector: '.duration', text: true },
  views: { selector: '.video_views', text: true },
  rating: { selector: '.mini-rating', text: true },
};
const meta = (name) => ({
  selector: `meta[property="${name}"],meta[name="${name}"]`,
  attr: 'content',
});
const linked = (selector) => ({
  selector: selector + ' a',
  all: true,
  fields: { url: { attr: 'href' }, name: { text: true } },
});
const absolute = (value, page) => httpUrl(value, page)?.href ?? '';
const titleTags = (value) =>
  [
    ...new Set(
      value
        .split(/[,/|]/)
        .map(text)
        .filter((v) => v.length > 2),
    ),
  ].slice(0, 4);
function card(row, page, base, playable = false) {
  const path = moviePath(row.url, base),
    title = first(row.image?.alt, row.title, path.split('/').at(-1));
  if (!path || !title) return null;
  const poster = absolute(row.image?.lazy, page) || absolute(row.image?.src, page);
  const id = 'porno365-' + encodeURIComponent(path);
  const url = new URL('porno365://video');
  url.searchParams.set('path', path);
  return {
    id,
    webUrl: new URL(base + path).href,
    title,
    subtitle: [row.duration, row.views].map(text).filter(Boolean).join(' • '),
    kind: 'movie',
    rating: percent(row.rating),
    posterUrl: poster,
    backdropUrl: poster,
    isNsfw: true,
    tags: titleTags(title),
    ...(playable
      ? {
          playbackGroups: [
            {
              id: id + '-porno365',
              playerId: 'porno365',
              playerLabel: 'Porno365',
              title: 'Porno365',
              subtitle: 'Direct MP4',
              episodes: [{ id: id + '-video', title, number: '1', url: url.href }],
            },
          ],
        }
      : {}),
  };
}
export default function createSource(context) {
  let current;
  async function configuration() {
    const override = (await context.settings.network()).baseUrl,
      base = (override || context.baseUrl).replace(/\/+$/, '');
    if (current?.base !== base)
      current = { base, active: base, filters: null, overridden: Boolean(override) };
    return current;
  }
  async function get(scope, path, start = scope.active) {
    const request = async (base) => {
      const url = new URL(base + path).href;
      const response = await context.http.request({
        method: 'GET',
        url,
        responseType: 'text',
        userAgentProfile: 'browser',
        headers: { Accept: 'text/html', Referer: base + '/', Origin: new URL(base).origin },
      });
      const page = httpUrl(response.url || url);
      if (!page || !isSiteUrl(page, scope.base))
        throw fail('Porno365 mirror redirected outside its site origins', 'network');
      const suffix = new URL(path, 'https://catalog.invalid').pathname.replace(/\/+$/, '');
      const pathname = page.pathname.replace(/\/+$/, '');
      const prefix = pathname.endsWith(suffix)
        ? pathname.slice(0, pathname.length - suffix.length)
        : '';
      scope.active = page.origin + prefix;
      return { html: text(response.body), page: page.href, base: scope.active };
    };
    try {
      return await request(start);
    } catch (error) {
      if (
        start === scope.base ||
        start !== scope.active ||
        !(['network', 'offline', 'timeout'].includes(error?.code) || error?.httpStatus >= 500)
      )
        throw error;
      // Re-discover a rotated mirror through the user's configured entry URL.
      return request(scope.base);
    }
  }
  async function getFilters({ refresh = false } = {}) {
    const scope = await configuration();
    if (scope.filters && !refresh) return scope.filters;
    async function options(path, model) {
      try {
        const { html, base } = await get(scope, path),
          rows = array(
            await context.html.extract(html, {
              selector: model ? 'a[href*="/models/"]' : 'a.categories-link',
              all: true,
              fields: {
                url: { attr: 'href' },
                title: { attr: 'title' },
                name: { selector: model ? '.model_rus_name' : '.title', text: true },
                alt: { selector: 'img', attr: 'alt' },
                count: { selector: model ? '.cnt_span' : '.text', text: true },
              },
            }),
          );
        return dedupe(
          rows
            .map((row) => ({
              value: model ? modelPath(row.url, base) : categoryPath(row.url, base),
              label: model ? first(row.name, row.alt) : first(row.title, row.name),
              count: Number(text(row.count).replace(/\D/g, '')) || null,
            }))
            .filter((row) => row.value && row.label),
          (v) => v.value,
        );
      } catch (error) {
        if (['permission_denied', 'cancelled', 'auth_session_changed'].includes(error?.code))
          throw error;
        return [];
      }
    }
    const [categories, models] = await Promise.all([
      options('/categories', false),
      options('/models', true),
    ]);
    return (scope.filters = [
      ...[
        ['category', 'genre', categories],
        ['model', 'actor', models],
      ]
        .filter(([, , rows]) => rows.length)
        .map(([id, key, rows]) => ({
          id,
          title: `source_filter.${key}`,
          kind: 'singleSelect',
          options: [{ value: '', label: 'source_filter.any' }, ...rows],
        })),
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        defaultValues: ['new'],
        options: ['new', 'popular_month', 'popular', 'rating_month', 'rating'].map((value) => ({
          value,
          label: `source_filter.sort.${value}`,
        })),
      },
    ]);
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, Math.trunc(Number(page)) || 1);
    const scope = await configuration(),
      f = selectedFilters,
      term = text(searchTerm),
      route = term
        ? '/search/' + encodeURIComponent(term)
        : first(
            directPath(f.path?.[0], scope.active),
            directPath(f.model?.[0], scope.active),
            directPath(f.category?.[0], scope.active),
          );
    const sort =
        {
          popular_month: '/popular/month',
          popular: '/popular',
          rating_month: '/toprated/month',
          rating: '/toprated',
        }[f.sort?.[0]] || '',
      path =
        term && !sort && page === 1
          ? '/search/?' + new URLSearchParams({ q: term })
          : route + sort + (page > 1 ? '/' + page : '') || '/';
    const { html, page: responseUrl, base } = await get(scope, path),
      data = object(
        await context.html.extract(html, {
          fields: {
            cards: { selector: 'li.video_block', all: true, fields: cardFields },
            next: {
              selector: '.pagination a, .navigation a',
              all: true,
              fields: { url: { attr: 'href' }, label: { text: true } },
            },
          },
        }),
      );
    const items = dedupe(
      array(data.cards)
        .map((row) => card(row, responseUrl, base))
        .filter(Boolean),
      (v) => v.id,
    ).slice(0, 50);
    return {
      items,
      hasMore:
        array(data.next).some((v) => {
          try {
            const next = new URL(v.url, responseUrl);
            return (
              isSiteUrl(next, base) && next.pathname.replace(/\/+$/, '').endsWith('/' + (page + 1))
            );
          } catch {
            return false;
          }
        }) || items.length >= 50,
    };
  }
  async function loadDetails({ itemId }) {
    const scope = await configuration();
    let path;
    try {
      const value = decodeURIComponent(itemId.startsWith('porno365-') ? itemId.slice(9) : itemId);
      path = moviePath(value, scope.active) || moviePath(value, scope.base);
    } catch {
      return null;
    }
    if (!path) return null;
    const { html, page, base } = await get(scope, path),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: meta('og:title'),
            heading: { selector: 'h1', text: true },
            poster: meta('og:image'),
            duration: meta('og:duration'),
            iso: { selector: 'meta[itemprop="duration"]', attr: 'content' },
            rating: { selector: 'meta[itemprop="ratingValue"]', attr: 'content' },
            ratingText: { selector: '.rating_score', text: true },
            description: { selector: '.story_desription', text: true },
            summary: meta('og:description'),
            categories: linked('.video-categories'),
            models: linked('.video-models'),
            tags: linked('.video-tags'),
            related: { selector: 'li.related_video', all: true, fields: cardFields },
          },
        }),
      );
    const title = first(data.title, data.heading, path.split('/').at(-1)),
      poster = absolute(data.poster, page),
      iso = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(text(data.iso));
    const duration =
        Number(data.duration) ||
        (iso ? Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) : null),
      metadata = [];
    const linkedRows = (key) =>
        dedupe(
          array(data[key])
            .map((v) => ({ name: text(v.name), path: directPath(v.url, base) }))
            .filter((v) => v.name && v.path),
          (v) => v.path,
        ),
      categories = linkedRows('categories'),
      models = linkedRows('models'),
      tags = linkedRows('tags');
    for (const [rows, kind, label] of [
      [categories.filter((v) => !models.some((m) => m.path === v.path)), 'genre', 'genre'],
      [models, 'studio', 'actor'],
      [tags, 'tag', 'tag'],
    ])
      for (const row of rows)
        metadata.push({
          kind,
          labelKey: `media.metadata.${label}`,
          value: row.name.replace(/^#/, ''),
          filterId: 'path',
          filterValue: row.path,
        });
    const url = new URL('porno365://video');
    url.searchParams.set('path', path);
    return {
      id: 'porno365-' + encodeURIComponent(path),
      webUrl: page,
      title,
      subtitle: duration == null ? '' : formatDuration(duration),
      overview: first(data.description, data.summary),
      kind: 'movie',
      rating: percent(first(data.rating, data.ratingText)),
      posterUrl: poster,
      backdropUrl: poster,
      isNsfw: true,
      tags: dedupe(
        [...categories.map((v) => v.name), ...tags.map((v) => v.name.replace(/^#/, ''))],
        (v) => v,
      ),
      metadata,
      playbackGroups: [
        {
          id: `${itemId}-porno365`,
          playerId: 'porno365',
          playerLabel: 'Porno365',
          title: 'Porno365',
          subtitle: 'Direct MP4',
          episodes: [
            { id: `${itemId}-video`, title, number: '1', url: url.href, durationSeconds: duration },
          ],
        },
      ],
      relatedItems: dedupe(
        array(data.related)
          .map((v) => card(v, page, base, true))
          .filter((v) => v && v.id !== itemId),
        (v) => v.id,
      ).slice(0, 12),
    };
  }
  async function resolveStream({ url }) {
    const scope = await configuration(),
      input = new URL(url),
      wrapped = input.protocol === 'porno365:' && input.hostname === 'video',
      value = wrapped ? first(input.searchParams.get('path'), input.searchParams.get('url')) : url,
      path = moviePath(value, scope.active) || moviePath(value, scope.base);
    if (!path) throw fail('Unsupported Porno365 URL');
    // Saved episodes are resolved on the current mirror, including after a
    // custom address changes. Legacy direct links still work without an override.
    const start =
      !wrapped && !scope.overridden && scope.active === scope.base ? input.origin : scope.active;
    const { html, page } = await get(scope, path, start),
      data = object(
        await context.html.extract(html, {
          fields: {
            og: meta('og:video'),
            content: { selector: 'meta[itemprop="contentUrl"]', attr: 'content' },
          },
        }),
      ),
      headers = { Referer: page, Origin: new URL(page).origin };
    const allowedStream = (value) => {
      const uri = httpUrl(value);
      return (
        uri &&
        uri.protocol === 'https:' &&
        !uri.port &&
        /(?:^|\.)(?:vide365\.com|vidb365\.com)$/i.test(uri.hostname)
      );
    };
    const rows = array(literalProperty(html, 'sources')).filter((row) => allowedStream(row?.file));
    const fallback = first(data.og, data.content);
    if (!rows.length && allowedStream(fallback)) rows.push({ file: fallback });
    const variants = dedupe(
      rows.map((v) => ({
        quality:
          /\d{3,4}/.exec(text(v.label))?.[0] ??
          /(?:_|\/)(\d{3,4})p(?:[_.?/]|$)/.exec(v.file)?.[1] ??
          'auto',
        url: v.file,
        mimeType: 'video/mp4',
        headers,
        isPreferred: v.default === true,
      })),
      (v) => v.url,
    );
    if (!variants.length)
      throw fail('Porno365 player has no playable streams', 'stream_unavailable');
    return { variants };
  }
  return {
    getFilters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 } = {}) => search({ page, selectedFilters: { sort: ['popular'] } }),
    getLatest: ({ page = 1 } = {}) => search({ page }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
