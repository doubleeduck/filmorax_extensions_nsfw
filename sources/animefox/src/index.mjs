import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { createKodik, isKodik } from '../../../resolvers/kodik.mjs';
import { createTentacl } from './tentacl.mjs';
const imageFields = {
  fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
};
const links = (selector) => ({
  selector,
  all: true,
  fields: { url: { attr: 'href' }, name: { text: true } },
});
const cardFields = {
  url: { selector: 'a.short-title,a.tc-item', attr: 'href' },
  title: { selector: 'h2', text: true },
  hint: { selector: 'a.short-title,a.tc-item', attr: 'title' },
  image: { selector: 'img.poster', ...imageFields },
  rating: { selector: '.rate_nums', text: true },
  episodes: { selector: '.short-meta', text: true },
  genres: links('.short-cat a'),
};
const absolute = (value, base) =>
  text(value) && !text(value).startsWith('data:') ? new URL(value, base).href : '';
const rating = (value) =>
  Math.max(
    0,
    Math.min(10, Number(/\d+(?:[.,]\d+)?/.exec(text(value))?.[0].replace(',', '.')) || 0),
  );
const year = (value) => Number(/\b(?:19|20)\d{2}\b/.exec(text(value))?.[0]) || null;
export function slug(value) {
  if (!text(value)) return '';
  try {
    const uri = new URL(value, 'https://www.animefox.org'),
      last = uri.pathname.split('/').filter(Boolean).at(-1) ?? '';
    return last.replace(/\.html$/, '');
  } catch {
    return '';
  }
}
function metadata(kind, row, base) {
  return array(row?.links).length
    ? row.links
        .filter((v) => text(v.name))
        .map((link) => ({
          kind,
          labelKey: `media.metadata.${kind}`,
          value: text(link.name),
          filterId: 'path',
          filterValue: new URL(link.url, base).pathname,
        }))
    : text(row?.value)
      ? [{ kind, labelKey: `media.metadata.${kind}`, value: text(row.value) }]
      : [];
}
function card(row, base) {
  const id = slug(row.url),
    title = first(row.title, row.hint);
  if (!id || !title) return null;
  const poster = absolute(first(row.image?.lazy, row.image?.src), base),
    genres = dedupe(
      array(row.genres)
        .map((v) => text(v.name))
        .filter(Boolean),
      (v) => v,
    ),
    released = genres.map(year).find(Boolean) ?? null;
  return {
    id: 'animefox-' + id,
    webUrl: absolute(row.url, base),
    title,
    kind: 'anime',
    subtitle: [row.episodes, released ? String(released) : '']
      .map(text)
      .filter(Boolean)
      .join(' / '),
    rating: rating(row.rating),
    year: released,
    posterUrl: poster,
    backdropUrl: poster,
    isNsfw: true,
    tags: genres.slice(0, 8),
    metadata: metadata('genre', { links: row.genres }, base),
  };
}
const selectedSection = (f) => (f.section?.[0] === 'anime' ? 'anime' : 'hentai');
function pathFromValue(value, base) {
  if (!text(value)) return '';
  try {
    return new URL(value, base).pathname.replace(/\/?$/, '/');
  } catch {
    return '';
  }
}
export function serializedFilters(filters) {
  const result = new URLSearchParams(),
    add = (key, values) => {
      for (const value of array(values).map(text).filter(Boolean)) result.append(key, value);
    };
  add('cat', [
    ...(selectedSection(filters) === 'hentai' && !array(filters.types).length ? ['102'] : []),
    ...array(filters.types),
    ...array(filters.include_genres),
  ]);
  add('!cat', filters.exclude_genres);
  for (const key of ['year1', 'voice', 'quality']) add(key, filters[key]);
  add('stydi', filters.studio);
  add('sort', [first(filters.sort?.[0], 'date')]);
  add('order', [first(filters.order?.[0], 'desc')]);
  return result.toString();
}
export default function createSource(context) {
  const tentacl = createTentacl(context),
    kodik = createKodik(context),
    origin = async () =>
      ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  async function request(
    path,
    { params = {}, body, referer = '', json = false, xhr = false } = {},
  ) {
    const base = await origin(),
      url = new URL(base + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return (
      await context.http.request({
        method: body ? 'POST' : 'GET',
        url: url.href,
        responseType: json ? 'json' : 'text',
        userAgentProfile: 'browser',
        headers: {
          Accept: xhr ? '*/*' : 'text/html',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          Origin: base,
          Referer: referer || base + '/hentai/',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(xhr ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
        },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      })
    ).body;
  }
  async function getFilters() {
    const html = text(await request('/hentai/')),
      selects = array(
        await context.html.extract(html, {
          selector: 'form.filter select',
          all: true,
          fields: {
            name: { attr: 'name' },
            id: { attr: 'id' },
            placeholder: { attr: 'data-placeholder' },
            options: {
              selector: 'option',
              all: true,
              fields: { value: { attr: 'value' }, label: { text: true } },
            },
          },
        }),
      );
    const options = (row) =>
        dedupe(
          array(row?.options)
            .map((v) => ({ value: text(v.value), label: text(v.label) }))
            .filter((v) => v.value && v.label),
          (v) => v.value,
        ),
      byName = (name) => options(selects.find((v) => v.name === name)),
      types = options(selects.find((v) => v.name === 'cat' && /тип/i.test(v.placeholder))),
      genres = options(selects.find((v) => v.name === 'cat' && v.id === 'include-genre'));
    const result = [
      {
        id: 'section',
        title: 'source_filter.section',
        kind: 'singleSelect',
        defaultValues: ['hentai'],
        options: ['hentai', 'anime'].map((value) => ({
          value,
          label: `source_filter.section.${value}`,
        })),
      },
    ];
    if (types.length)
      result.push({
        id: 'types',
        title: 'source_filter.type',
        kind: 'multiSelect',
        options: types,
      });
    if (!selects.length) return result;
    for (const [id, key, rows] of [
      ['include_genres', 'genres', genres],
      ['exclude_genres', 'exclude_genres', genres],
      ['year1', 'year', byName('year1')],
      ['voice', 'translation', byName('voice')],
      ['quality', 'quality', byName('quality')],
      ['studio', 'studio', byName('stydi')],
      ['sort', 'sort', byName('sort')],
    ])
      if (rows.length)
        result.push({
          id,
          title: `source_filter.${key}`,
          kind: id === 'sort' ? 'sort' : 'multiSelect',
          ...(id === 'sort' ? { defaultValues: ['date'] } : {}),
          options: rows,
        });
    result.push({
      id: 'order',
      title: 'source_filter.direction',
      kind: 'singleSelect',
      defaultValues: ['desc'],
      options: ['desc', 'asc'].map((value) => ({
        value,
        label: `source_filter.direction.${value}`,
      })),
    });
    return result;
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const f = selectedFilters,
      section = selectedSection(f),
      base = await origin(),
      direct = pathFromValue(f.path?.[0], base),
      initial = direct || `/${section}/`,
      term = text(searchTerm);
    let html;
    if (term)
      html = text(
        await request('/', {
          body: {
            do: 'search',
            subaction: 'search',
            story: term,
            'catlist[]': section === 'anime' ? '1' : '102',
            search_start: String(page),
          },
          referer: `${base}/${section}/`,
        }),
      );
    else if (
      Object.entries(f).some(
        ([key, values]) => !['section', 'path'].includes(key) && array(values).some(text),
      )
    ) {
      const seed = text(await request(initial)),
        hash = /dle_login_hash\s*=\s*['"]([^'"]+)/.exec(seed)?.[1] ?? '',
        payload = object(
          await request('/engine/lazydev/dle_filter/ajax.php', {
            body: { data: serializedFilters(f), url: initial, dle_hash: hash, dleFilterJSData: '' },
            referer: base + initial,
            json: true,
          }),
        );
      html = text(payload.content);
      if (page > 1) {
        const nav = first(payload.nav, payload.content),
          links = array(
            await context.html.extract(nav, {
              selector: 'a[href]',
              all: true,
              fields: { url: { attr: 'href' }, label: { text: true } },
            }),
          ),
          found = links.find((v) => Number(v.label) === page),
          clean = pathFromValue(first(payload.clean, payload.url), base),
          path = found ? pathFromValue(found.url, base) : clean ? clean + `page/${page}/` : '';
        if (path) html = text(await request(path, { referer: base + clean }));
      }
    } else html = text(await request(initial + (page > 1 ? `page/${page}/` : '')));
    const data = object(
        await context.html.extract(html, {
          fields: {
            cards: { selector: 'article.short', all: true, fields: cardFields },
            next: {
              selector: '.navigation a,.pagination a',
              all: true,
              fields: { label: { text: true }, url: { attr: 'href' } },
            },
          },
        }),
      ),
      items = dedupe(
        array(data.cards)
          .map((row) => card(row, base))
          .filter(Boolean),
        (v) => v.id,
      ).slice(0, 20);
    return {
      items,
      hasMore:
        array(data.next).some(
          (v) => Number(v.label) === page + 1 || new RegExp(`/page/${page + 1}/`).test(v.url),
        ) || items.length >= 20,
    };
  }
  async function loadDetails({ itemId }) {
    const id = slug(itemId.startsWith('animefox-') ? itemId.slice(9) : itemId);
    if (!id) return null;
    const base = await origin(),
      itemUrl = `${base}/${id}.html`,
      html = text(await request('/' + id + '.html')),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: { selector: 'h1', text: true },
            subtitle: { selector: '.subtitle', text: true },
            poster: {
              selector: 'meta[property="og:image"],meta[itemprop="image"]',
              attr: 'content',
            },
            image: { selector: '.full_poster img,img.poster', ...imageFields },
            description: { selector: '#full_desc', text: true },
            rating: { selector: '.rate_nums', text: true },
            info: {
              selector: '.full_info ul li',
              all: true,
              fields: {
                label: { selector: 'span', text: true },
                full: { text: true },
                links: links('a'),
              },
            },
            playerId: { selector: '[id^="iframePlayer-"]', attr: 'id' },
            frame: { selector: '[data-frame]', attr: 'data-frame' },
            direct: { selector: 'iframe.iframePlayer', attr: 'src' },
            related: {
              selector: '.full_related .related_short',
              all: true,
              fields: {
                url: { selector: 'h2 a,.short-text a,a[href]', attr: 'href' },
                data: { selector: '[data-href]', attr: 'data-href' },
                title: { selector: 'h2 a,.short-text a', text: true },
                image: { selector: 'img', ...imageFields },
              },
            },
          },
        }),
      );
    const title = text(data.title);
    if (!title) return null;
    const info = new Map(
        array(data.info).map((row) => {
          const label = text(row.label).replace(/:$/, '').trim().toLowerCase(),
            full = text(row.full),
            at = full.toLowerCase().indexOf(label);
          return [
            label,
            {
              value: (at === 0 ? full.slice(label.length) : full).replace(/^\s*:\s*/, ''),
              links: row.links,
            },
          ];
        }),
      ),
      row = (name) => info.get(name.toLowerCase()) ?? {},
      translation = first(row('Озвучка').value, row('Перевод').value),
      quality = text(row('Качество').value),
      released = year(row('Год').value),
      episodesText = text(row('Эпизоды').value),
      poster = absolute(first(data.poster, data.image?.src, data.image?.lazy), base),
      entries = [];
    for (const [label, kind] of [
      ['Категории', 'genre'],
      ['Тип', 'type'],
      ['Год', 'year'],
      ['Качество', 'quality'],
      ['Студия', 'studio'],
      ['Режиссёр', 'director'],
    ])
      entries.push(...metadata(kind, row(label), base));
    if (translation)
      entries.push({
        kind: 'translation',
        labelKey: 'media.metadata.translation',
        value: translation,
      });
    if (episodesText)
      entries.push({ kind: 'episodes', labelKey: 'media.metadata.episodes', value: episodesText });
    const postId = first(/iframePlayer-(\d+)/.exec(text(data.playerId))?.[1], data.frame),
      direct = absolute(data.direct, base),
      groups = [];
    if (direct && /^https:\/\//.test(direct))
      groups.push({
        id: 'animefox-direct',
        playerId: isKodik(direct) ? 'kodik' : 'animefox',
        playerLabel: isKodik(direct) ? 'Kodik' : 'AnimeFox',
        title: isKodik(direct) ? 'Kodik' : 'AnimeFox',
        subtitle: isKodik(direct) ? 'AnimeFox' : '',
        episodes: [
          { id: 'animefox-direct-1', title: 'source_filter.episode_1', number: '1', url: direct },
        ],
      });
    else if (postId) {
      const count = Math.max(
        1,
        Math.min(10000, Number(/из\s+(\d+)/i.exec(episodesText)?.[1]) || Number(episodesText) || 1),
      );
      groups.push({
        id: 'animefox-' + postId,
        playerId: 'animefox',
        playerLabel: 'AnimeFox',
        title: 'AnimeFox',
        subtitle: 'Tentacl',
        episodes: Array.from({ length: count }, (_, index) => {
          const number = index + 1,
            uri = new URL(`${base}/embed/${postId}/`);
          uri.searchParams.set('series', String(number));
          uri.searchParams.set('referer', itemUrl);
          return {
            id: `${postId}-${number}`,
            title: count === 1 ? 'source_filter.episode_1' : `episodes.fallback ${number}`,
            number: String(number),
            url: uri.href,
          };
        }),
      });
    }
    const relatedItems = dedupe(
      array(data.related)
        .map((v) => {
          const raw = first(v.url, v.data);
          let uri;
          try {
            uri = new URL(raw, base);
          } catch {
            return null;
          }
          if (
            !['animefox.org', 'www.animefox.org', new URL(base).hostname].includes(uri.hostname) ||
            !uri.pathname.endsWith('.html')
          )
            return null;
          const id = slug(uri.href),
            title = first(v.title, v.image?.alt),
            poster = absolute(first(v.image?.lazy, v.image?.src), base);
          return id && title
            ? {
                id: 'animefox-' + id,
                webUrl: uri.href,
                title,
                kind: 'anime',
                posterUrl: poster,
                backdropUrl: poster,
                isNsfw: true,
              }
            : null;
        })
        .filter((v) => v && v.id !== itemId),
      (v) => v.id,
    ).slice(0, 48);
    return {
      id: 'animefox-' + id,
      webUrl: itemUrl,
      title,
      originalTitle: text(data.subtitle),
      subtitle: [data.subtitle, episodesText, released ? String(released) : '']
        .map(text)
        .filter(Boolean)
        .join(' / '),
      overview: text(data.description),
      kind: 'anime',
      rating: rating(data.rating),
      year: released,
      posterUrl: poster,
      backdropUrl: poster,
      isNsfw: true,
      tags: dedupe(
        [...array(row('Категории').links).map((v) => text(v.name)), translation, quality].filter(
          Boolean,
        ),
        (v) => v,
      ).slice(0, 8),
      metadata: dedupe(entries, (v) => `${v.kind}:${v.value.toLowerCase()}`),
      playbackGroups: groups,
      relatedItems,
    };
  }
  async function playerPayload(uri) {
    const base = await origin(),
      id = uri.pathname.split('/').filter(Boolean)[1];
    if (!/^\d+$/.test(id)) return null;
    const referer = titleReferer(uri, base),
      series = text(uri.searchParams.get('series')),
      data = object(
        await request('/index.php', {
          params: { controller: 'ajax', mod: 'iframePlayer' },
          body: { post_id: id, ...(series ? { select: 'series=' + series } : {}) },
          referer,
          json: true,
          xhr: true,
        }),
      );
    if (data.success !== true) return null;
    const [iframe, rows] = await Promise.all([
      context.html.extract(text(data.player), { selector: 'iframe[src]', attr: 'src' }),
      context.html.extract(text(data.selectors), {
        selector: 'select[name="series"] option,body > option',
        all: true,
        fields: { number: { attr: 'value' }, title: { text: true } },
      }),
    ]);
    return {
      iframe: absolute(iframe, base),
      episodes: dedupe(
        array(rows)
          .filter((v) => Number(v.number) > 0)
          .map((v) => ({
            number: text(v.number),
            title: first(v.title, 'episodes.fallback ' + v.number),
          })),
        (v) => v.number,
      ),
    };
  }
  function titleReferer(uri, base) {
    try {
      const ref = new URL(uri.searchParams.get('referer'));
      if (
        ref.protocol === 'https:' &&
        ['animefox.org', 'www.animefox.org', new URL(base).hostname].includes(ref.hostname)
      )
        return ref.href;
    } catch {}
    return base + '/';
  }
  async function loadPlaybackGroups(args) {
    if (!args.url) return (await loadDetails(args))?.playbackGroups ?? [];
    const uri = new URL(args.url);
    if (!uri.pathname.startsWith('/embed/') || uri.hostname === 'x.tentacl.su') return [];
    const payload = await playerPayload(uri);
    if (!payload?.iframe || new URL(payload.iframe).hostname !== 'x.tentacl.su') return [];
    const base = await origin(),
      servers = await tentacl.loadServers(payload.iframe, titleReferer(uri, base));
    if (!servers.length) return [];
    const postId = uri.pathname.split('/').filter(Boolean)[1],
      episodes = payload.episodes.length
        ? payload.episodes
        : [{ number: '1', title: 'episodes.fallback 1' }];
    return [{ id: '', title: 'AnimeFox' }, ...servers].map((server) => ({
      id: `animefox-${postId}${server.id ? '-' + server.id : ''}`,
      playerId: server.id ? 'animefox:' + server.id : 'animefox',
      playerLabel: server.id ? server.title : 'AnimeFox',
      title: server.title,
      subtitle: server.id ? 'Tentacl' : 'Tentacl · Auto',
      episodes: episodes.map((row) => {
        const url = new URL(uri);
        url.searchParams.delete('player');
        url.searchParams.set('series', row.number);
        if (server.id) url.searchParams.set('player', server.id);
        return {
          id: `${postId}-${row.number}`,
          title: row.title,
          number: row.number,
          url: url.href,
        };
      }),
    }));
  }
  async function resolveStream({ url }) {
    if (isKodik(url)) return kodik(url);
    const uri = new URL(url),
      base = await origin();
    let target = uri.href,
      referer = titleReferer(uri, base),
      server = text(uri.searchParams.get('player'));
    if (
      ['animefox.org', 'www.animefox.org', new URL(base).hostname].includes(uri.hostname) &&
      uri.pathname.startsWith('/embed/')
    ) {
      const payload = await playerPayload(uri);
      if (!payload?.iframe) throw fail('AnimeFox iframe was not found', 'stream_unavailable');
      target = payload.iframe;
    }
    if (isKodik(target)) return kodik(target);
    if (new URL(target).hostname === 'x.tentacl.su')
      return tentacl.resolve(target, referer, server);
    throw fail('Unsupported AnimeFox provider');
  }
  return {
    getFilters,
    search,
    loadDetails,
    loadPlaybackGroups,
    resolveStream,
    getPopular: ({ page = 1 }) =>
      search({
        page,
        selectedFilters: { section: ['hentai'], sort: ['news_read'], order: ['desc'] },
      }),
    getLatest: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['hentai'], sort: ['date'], order: ['desc'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
  };
}
