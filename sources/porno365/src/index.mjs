import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { literalProperty } from '../../../sdk/literal.mjs';
export const isSite = (host) => /(?:^|[.-])[a-z0-9-]*porno365(?=[.-]|$)/i.test(host);
export function sitePath(value, pattern) {
  if (!text(value)) return '';
  try {
    const uri = new URL(value, 'https://porno365.plus');
    if (!isSite(uri.hostname)) return '';
    const path = decodeURI(uri.pathname).replace(/\/+$/, '') || '/';
    return pattern.test(path) ? path : '';
  } catch {
    return '';
  }
}
const moviePath = (value) => sitePath(value, /^\/movie\/\d+$/);
const modelPath = (value) => {
  const path = sitePath(value, /^\/models\/[\p{L}\p{N}_-]+$/u),
    slug = path.split('/').at(-1);
  return !path || /^(?:ru|male|all|sort-by-.*|\d+)$/.test(slug) ? '' : path;
};
const categoryPath = (value) => {
  const path = sitePath(value, /^\/[\p{L}\p{N}_-]+$/u);
  return ['/categories', '/models', '/search', '/popular', '/toprated'].includes(path.toLowerCase())
    ? ''
    : path;
};
const directPath = (value) => {
  const path = sitePath(value, /^\/(?:models|tags)\/[^/]+$|^\/[^/]+$/);
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
const absolute = (value, origin) => (text(value) ? new URL(value, origin).href : '');
const titleTags = (value) =>
  value
    .split(/[,/|]/)
    .map(text)
    .filter((v) => v.length > 2)
    .slice(0, 4);
function card(row, origin) {
  const path = moviePath(row.url),
    title = first(row.image?.alt, row.title, path.split('/').at(-1));
  if (!path || !title) return null;
  const poster = absolute(first(row.image?.lazy, row.image?.src), origin);
  return {
    id: 'porno365-' + encodeURIComponent(path),
    webUrl: new URL(path, origin).href,
    title,
    subtitle: [row.duration, row.views].map(text).filter(Boolean).join(' • '),
    kind: 'movie',
    rating: percent(row.rating),
    posterUrl: poster,
    backdropUrl: poster,
    isNsfw: true,
    tags: titleTags(title),
  };
}
export default function createSource(context) {
  let configured = '',
    resolved = '',
    filters;
  async function origin() {
    const base = ((await context.settings.network()).baseUrl || context.baseUrl).replace(
      /\/+$/,
      '',
    );
    if (base !== configured) {
      configured = base;
      resolved = '';
      filters = null;
    }
    return resolved || base;
  }
  async function get(path) {
    const base = await origin();
    let response;
    try {
      response = await context.http.request({
        method: 'GET',
        url: base + path,
        responseType: 'text',
        userAgentProfile: 'browser',
        headers: { Accept: 'text/html', Referer: base + '/', Origin: base },
      });
    } catch (error) {
      if (error?.code !== 'network_error' || base === context.baseUrl) throw error;
      response = await context.http.request({
        method: 'GET',
        url: context.baseUrl + path,
        responseType: 'text',
        userAgentProfile: 'browser',
      });
    }
    const final = new URL(response.url || base + path);
    if (isSite(final.hostname)) resolved = final.origin;
    return { html: text(response.body), origin: final.origin };
  }
  async function getFilters({ refresh = false } = {}) {
    await origin();
    if (filters && !refresh) return filters;
    async function options(path, model) {
      try {
        const { html } = await get(path),
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
              value: model ? modelPath(row.url) : categoryPath(row.url),
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
    return (filters = [
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
    const f = selectedFilters,
      term = text(searchTerm),
      base = term
        ? '/search/' + encodeURIComponent(term)
        : first(directPath(f.path?.[0]), directPath(f.model?.[0]), directPath(f.category?.[0]));
    const sort =
        {
          popular_month: '/popular/month',
          popular: '/popular',
          rating_month: '/toprated/month',
          rating: '/toprated',
        }[f.sort?.[0]] || '',
      path = base + sort + (page > 1 ? '/' + page : '') || '/';
    const { html, origin } = await get(path),
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
        .map((row) => card(row, origin))
        .filter(Boolean),
      (v) => v.id,
    ).slice(0, 50);
    return {
      items,
      hasMore: array(data.next).some((v) => Number(v.label) === page + 1) || items.length >= 50,
    };
  }
  async function loadDetails({ itemId }) {
    const path = moviePath(
      decodeURIComponent(itemId.startsWith('porno365-') ? itemId.slice(9) : itemId),
    );
    if (!path) return null;
    const { html, origin } = await get(path),
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
      poster = absolute(data.poster, origin),
      iso = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(text(data.iso));
    const duration =
        Number(data.duration) ||
        (iso ? Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) : null),
      metadata = [];
    const linkedRows = (key) =>
        dedupe(
          array(data[key])
            .map((v) => ({ name: text(v.name), path: sitePath(v.url, /^\/.+$/) }))
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
    url.searchParams.set('url', origin + path);
    return {
      id: 'porno365-' + encodeURIComponent(path),
      webUrl: new URL(path, origin).href,
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
          .map((v) => card(v, origin))
          .filter((v) => v && v.id !== itemId),
        (v) => v.id,
      ).slice(0, 12),
    };
  }
  async function resolveStream({ url }) {
    const input = new URL(url),
      page = new URL(input.protocol === 'porno365:' ? input.searchParams.get('url') : url);
    if (!isSite(page.hostname) || !moviePath(page.href)) throw fail('Unsupported Porno365 URL');
    if (page.protocol === 'http:') page.protocol = 'https:';
    const html = text(
        (
          await context.http.request({
            method: 'GET',
            url: page.href,
            responseType: 'text',
            userAgentProfile: 'browser',
            headers: { Referer: page.origin + '/', Origin: page.origin },
          })
        ).body,
      ),
      data = object(
        await context.html.extract(html, {
          fields: {
            og: meta('og:video'),
            content: { selector: 'meta[itemprop="contentUrl"]', attr: 'content' },
          },
        }),
      ),
      headers = { Referer: page.href, Origin: page.origin };
    const rows = array(literalProperty(html, 'sources')),
      fallback = first(data.og, data.content);
    if (fallback) rows.push({ file: fallback });
    const variants = dedupe(
      rows
        .filter((v) => /^https:\/\//.test(text(v.file)))
        .map((v) => ({
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
    getPopular: ({ page = 1 }) => search({ page, selectedFilters: { sort: ['popular'] } }),
    getLatest: ({ page = 1 }) => search({ page }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
