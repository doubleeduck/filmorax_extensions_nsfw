import { text, array, object, first, dedupe } from '../../../sdk/video.mjs';
import { createPlayer } from './player.mjs';
const imageFields = {
  fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
};
const cardFields = {
  url: { selector: 'a[href*="/series/"]', attr: 'href' },
  name: { selector: 'h3 a, .title a', text: true },
  image: { selector: 'img', ...imageFields },
  year: { selector: '.year, .buttonyear', text: true },
  censorship: { selector: '.buttoncensured', text: true },
  overview: { selector: '.contenido', text: true },
};
const meta = (name) => ({
  selector: `meta[property="${name}"],meta[name="${name}"]`,
  attr: 'content',
});
const linked = (selector) => ({
  selector,
  all: true,
  fields: { url: { attr: 'href' }, name: { text: true } },
});
const year = (value) => Number(/(?:19|20)\d{2}/.exec(text(value))?.[0]) || null;
const absolute = (value, base) =>
  text(value) && !text(value).startsWith('data:') ? new URL(value, base).href : '';
export function seriesPath(value) {
  if (!text(value)) return '';
  try {
    const path = new URL(value, 'https://watchhentai.net').pathname;
    return /^\/series\/[^/]+\/?$/.test(path) ? path.replace(/\/?$/, '/') : '';
  } catch {
    return '';
  }
}
function taxonomy(value, name) {
  if (!text(value)) return '';
  try {
    return (
      new RegExp(`/${name}/([^/]+)`).exec(
        new URL(value, 'https://watchhentai.net').pathname,
      )?.[1] ?? ''
    );
  } catch {
    return '';
  }
}
function card(row, base) {
  const path = seriesPath(row.url),
    title = first(row.name, row.image?.alt);
  if (!path || !title) return null;
  const poster = absolute(first(row.image?.lazy, row.image?.src), base),
    released = year(row.year),
    censorship = text(row.censorship);
  return {
    id: 'watchhentai-' + encodeURIComponent(path),
    webUrl: new URL(path, base).href,
    title,
    subtitle: [released ? String(released) : '', censorship].filter(Boolean).join(' / '),
    overview: text(row.overview),
    kind: 'anime',
    year: released,
    posterUrl: poster,
    backdropUrl: poster,
    isNsfw: true,
    tags: censorship ? [censorship] : [],
  };
}
export default function createSource(context) {
  let filters;
  const resolveStream = createPlayer(context),
    origin = async () =>
      ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  async function get(path, params = {}) {
    const base = await origin(),
      url = new URL(base + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return {
      base,
      html: text(
        (
          await context.http.request({
            method: 'GET',
            url: url.href,
            responseType: 'text',
            userAgentProfile: 'browser',
            headers: {
              Referer: base + '/',
              Accept: 'text/html',
              'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
            },
          })
        ).body,
      ),
    };
  }
  async function getFilters({ refresh = false } = {}) {
    if (filters && !refresh) return filters;
    const { html } = await get('/series/'),
      data = object(
        await context.html.extract(html, {
          fields: {
            selects: {
              selector: 'select',
              all: true,
              fields: {
                options: {
                  selector: 'option',
                  all: true,
                  fields: { url: { attr: 'value' }, name: { text: true } },
                },
              },
            },
            links: linked('a[href]'),
          },
        }),
      );
    const selects = array(data.selects),
      links = array(data.links),
      options = (rows, type) =>
        dedupe(
          rows
            .map((row) => ({
              value: type === 'release' ? text(year(row.name) || '') : taxonomy(row.url, type),
              label: text(row.name),
            }))
            .filter((row) => row.value && row.label),
          (v) => v.value,
        );
    const genres = options(selects.length ? array(selects[0].options) : links, 'genre'),
      years = options(
        selects.length > 1
          ? array(selects[1].options)
          : links.filter((row) => taxonomy(row.url, 'release')),
        'release',
      );
    return (filters = [
      ...[
        [genres, 'genre', 'genre'],
        [years, 'year', 'year'],
      ]
        .filter(([rows]) => rows.length)
        .map(([rows, id, key]) => ({
          id,
          title: `source_filter.${key}`,
          kind: 'singleSelect',
          options: [{ value: '', label: 'source_filter.any' }, ...rows],
        })),
    ]);
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const term = text(searchTerm),
      f = selectedFilters;
    const explicit = text(f.path?.[0]),
      safeExplicit = /^\/(?:series|genre|release|studio|network)\/(?:[^/]+\/)?$/.test(explicit)
        ? explicit
        : '';
    let path = term
      ? '/'
      : first(
          safeExplicit,
          text(f.genre?.[0]) ? `/genre/${encodeURIComponent(f.genre[0])}/` : '',
          text(f.year?.[0]) ? `/release/${encodeURIComponent(f.year[0])}/` : '',
          '/series/',
        );
    if (page > 1) path += `page/${page}/`;
    const { html, base } = await get(path, term ? { s: term } : {}),
      data = object(
        await context.html.extract(html, {
          fields: {
            primary: { selector: 'article.item.tvshows', all: true, fields: cardFields },
            search: { selector: 'article:not(.w_item_b)', all: true, fields: cardFields },
            next: {
              selector: '.pagination a, .resppages a',
              all: true,
              fields: { name: { text: true }, url: { attr: 'href' } },
            },
          },
        }),
      );
    const items = dedupe(
      (array(data.primary).length ? data.primary : array(data.search))
        .map((row) => card(row, base))
        .filter(Boolean),
      (v) => v.id,
    ).slice(0, 30);
    return {
      items,
      hasMore:
        array(data.next).some(
          (row) => Number(row.name) === page + 1 || new RegExp(`/page/${page + 1}/`).test(row.url),
        ) || items.length >= 30,
    };
  }
  async function loadDetails({ itemId }) {
    const path = seriesPath(
      decodeURIComponent(itemId.startsWith('watchhentai-') ? itemId.slice(12) : itemId),
    );
    if (!path) return null;
    const { html, base } = await get(path),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: { selector: '.data h1', text: true },
            ogTitle: meta('og:title'),
            image: { selector: '.poster img', ...imageFields },
            backdrop: meta('og:image'),
            overview: { selector: '.wp-content', text: true, exclude: 'h2,#dt_galery' },
            summary: meta('og:description'),
            date: { selector: '.data .extra .date', text: true },
            network: linked('.data .extra a[href*="/network/"]'),
            genres: linked('.data .sgeneros a'),
            custom: {
              selector: '.custom_fields',
              all: true,
              fields: {
                label: { selector: 'b', text: true },
                value: { selector: 'span', text: true },
                url: { selector: 'a', attr: 'href' },
              },
            },
            about: {
              selector: '.tv-about-field',
              all: true,
              fields: {
                label: { selector: '.tv-about-field__label', text: true },
                value: { selector: '.tv-about-field__value', text: true },
              },
            },
            rating: { selector: '.starstruck', attr: 'data-rating' },
            episodes: {
              selector: 'ul.episodios li',
              all: true,
              fields: {
                url: { selector: 'a', attr: 'href' },
                title: { selector: '.eptitle', text: true },
                anchor: { selector: 'a', text: true },
                date: { selector: '.date', text: true },
              },
            },
            related: { selector: '.srelacionados article', all: true, fields: cardFields },
          },
        }),
      );
    const title = first(data.title, text(data.ogTitle).replace(/\s*-\s*Watch Hentai.*$/i, ''));
    if (!title) return null;
    const metadata = [],
      add = (kind, value, filterId = '', filterValue = '') => {
        if (text(value))
          metadata.push({
            kind,
            labelKey: `media.metadata.${kind}`,
            value: text(value),
            ...(filterId && filterValue ? { filterId, filterValue } : {}),
          });
      };
    const released = year(data.date);
    if (released) add('year', released, 'year', String(released));
    for (const row of array(data.network).slice(0, 1)) {
      const slug = taxonomy(row.url, 'network');
      if (slug) add('publisher', row.name, 'path', `/network/${slug}/`);
    }
    for (const row of array(data.genres)) {
      const slug = taxonomy(row.url, 'genre');
      if (slug) add('genre', row.name, 'genre', slug);
    }
    for (const row of array(data.custom)) {
      const label = text(row.label).toLowerCase();
      if (label === 'episodes') add('episodes', row.value);
      else if (label === 'studio') {
        const slug = taxonomy(row.url, 'studio');
        add('studio', row.value, 'path', slug ? `/studio/${slug}/` : '');
      }
    }
    const about = new Map(
      array(data.about).map((v) => [text(v.label).toLowerCase(), text(v.value)]),
    );
    if (!metadata.some((v) => v.kind === 'episodes')) add('episodes', about.get('episodes'));
    const episodes = dedupe(
        array(data.episodes)
          .map((row) => {
            const title = first(row.title, row.anchor),
              number = /\d+(?:\.\d+)?/.exec(title)?.[0] ?? '';
            return title && text(row.url)
              ? {
                  id: `${itemId}-episode-${number || title}`,
                  title,
                  number: number || '1',
                  subtitle: text(row.date),
                  url: absolute(row.url, base),
                }
              : null;
          })
          .filter(Boolean),
        (v) => v.id,
      ),
      poster = absolute(first(data.image?.lazy, data.image?.src), base);
    return {
      id: 'watchhentai-' + encodeURIComponent(path),
      webUrl: new URL(path, base).href,
      title,
      originalTitle: about.get('alternative title') || '',
      subtitle: metadata
        .filter((v) => v.kind === 'studio' || v.kind === 'episodes')
        .map((v) => v.value)
        .join(' / '),
      overview: first(data.overview, data.summary),
      kind: 'anime',
      rating: Number(data.rating) || 0,
      year: released,
      posterUrl: poster,
      backdropUrl: absolute(data.backdrop, base) || poster,
      isNsfw: true,
      tags: dedupe(
        metadata.filter((v) => v.kind === 'genre').map((v) => v.value),
        (v) => v,
      ),
      metadata: dedupe(metadata, (v) => `${v.kind}:${v.value}`),
      playbackGroups: episodes.length
        ? [
            {
              id: `${itemId}-watchhentai`,
              title: 'WatchHentai',
              subtitle: 'JWPlayer',
              episodes,
              playerId: 'watchHentai',
              playerLabel: 'WatchHentai',
            },
          ]
        : [],
      relatedItems: dedupe(
        array(data.related)
          .map((row) => card(row, base))
          .filter((v) => v && v.id !== itemId),
        (v) => v.id,
      ).slice(0, 48),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 }) => search({ page }),
    getLatest: ({ page = 1 }) => search({ page }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
