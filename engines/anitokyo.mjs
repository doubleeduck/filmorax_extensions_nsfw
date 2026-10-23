import {
  text,
  array,
  object,
  first,
  fail,
  dedupe,
  queryUrl,
  jsonObjectAfter,
} from '../sdk/video.mjs';
import { createKodik, isKodik } from '../resolvers/kodik.mjs';
const normalize = (path, base) => {
  try {
    return new URL(path, base).pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  } catch {
    return '';
  }
};
const year = (value) => Number(/(?:19|20)\d{2}/.exec(text(value))?.[0]) || null;
const picture = {
  full: { selector: 'a.highslide, a[data-fancybox]', attr: 'href' },
  lazy: { selector: 'img', attr: 'data-src' },
  src: { selector: 'img', attr: 'src' },
};
const infoQuery = {
  selector: '.story-info li',
  all: true,
  fields: {
    label: { selector: 'b', text: true },
    value: { text: true, exclude: 'b' },
    links: { selector: 'a', all: true, text: true },
  },
};
const cardFields = {
  href: { selector: '.story-title a', attr: 'href' },
  fallbackHref: { selector: 'a[href]', attr: 'href' },
  title: { selector: '.story-title a, h3', text: true },
  poster: { fields: picture },
  info: { selector: '.story-info', text: true },
  overview: { selector: '.story-description', text: true },
  facts: infoQuery,
};
function genres(rows) {
  return dedupe(
    array(rows)
      .filter((row) => text(row.label).toLowerCase().includes('жанр'))
      .flatMap((row) => array(row.links))
      .map(text)
      .filter(Boolean),
    (v) => v,
  );
}
function metadata(rows) {
  return array(rows).flatMap((row) => {
    const label = text(row.label).toLowerCase(),
      value = text(row.value);
    if (!value) return [];
    const entry = (kind, value, filterId, filterValue) => ({
      kind,
      labelKey: `media.metadata.${kind}`,
      value,
      ...(filterId && filterValue ? { filterId, filterValue } : {}),
    });
    if (label.includes('год'))
      return [entry('year', value, 'year_min', year(value) ? String(year(value)) : '')];
    if (label.includes('производство')) return [entry('country', value, 'country', value)];
    if (label.includes('жанр'))
      return array(row.links)
        .map(text)
        .filter(Boolean)
        .map((v) => entry('genre', v, 'genre', v));
    if (label.includes('категор')) return [entry('type', value)];
    if (label.includes('серий')) return [entry('episodes', value)];
    if (label.includes('озвуч') || label.includes('субтитр'))
      return [entry('translation', value, 'voice', value)];
    if (label.includes('студи')) return [entry('studio', value, 'studio', value)];
    return [];
  });
}
export default function createSource(context) {
  const nsfw = context.parameters.isNsfw === 'true',
    id = context.sourceId;
  let cachedFilters;
  const kodik = createKodik(context),
    project = (body, query) => context.html.extract(body, query);
  const origin = async () => {
    const config = await context.settings.network();
    return (config.baseUrl || context.baseUrl).replace(/\/+$/, '');
  };
  async function request(path, { body, base } = {}) {
    base ??= await origin();
    return text(
      (
        await context.http.request({
          method: body == null ? 'GET' : 'POST',
          url: new URL(path, base).href,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            Referer: `${base}/`,
            Origin: new URL(base).origin,
            ...(body == null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          },
          ...(body == null ? {} : { body }),
        })
      ).body,
    );
  }
  function item(row, base) {
    const path = normalize(first(row.href, row.fallbackHref), base),
      title = text(row.title);
    if (!path || !title || (!nsfw && path.startsWith('hentai/'))) return null;
    const image = first(row.poster?.full, row.poster?.lazy, row.poster?.src),
      poster = image ? new URL(image, base).href : '';
    return {
      id: `${id}-${encodeURIComponent(path)}`,
      webUrl: new URL('/' + path + '.html', base).href,
      title,
      subtitle: text(row.info),
      overview: text(row.overview),
      kind: path.startsWith('movie/') ? 'movie' : 'anime',
      rating: 0,
      year: year(title + ' ' + text(row.info)),
      posterUrl: poster,
      backdropUrl: poster,
      isNsfw: nsfw,
      tags: genres(row.facts),
    };
  }
  async function getFilters({ refresh = false } = {}) {
    if (!refresh && cachedFilters) return cachedFilters;
    const rows = await project(await request('/?do=multisearch'), {
      selector: 'select[name]',
      all: true,
      fields: {
        name: { attr: 'name' },
        options: {
          selector: 'option[value]',
          all: true,
          fields: { value: { attr: 'value' }, label: { text: true } },
        },
      },
    });
    const fields = Object.fromEntries(
      array(rows).map((row) => [
        row.name,
        dedupe(
          array(row.options)
            .filter((o) => text(o.value) && text(o.label))
            .map((o) => ({ value: text(o.value), label: text(o.label) })),
          (o) => o.value,
        ),
      ]),
    );
    const opts = (name) => fields[name] ?? [],
      any = { value: '', label: 'source_filter.any' };
    const select = (key, title, name, kind = 'singleSelect') => ({
      id: key,
      title,
      kind,
      options: kind === 'singleSelect' ? [any, ...opts(name)] : opts(name),
    });
    const result = [];
    for (const [key, title, name, kind] of [
      ['country', 'country', 'country[]', 'multiSelect'],
      ['year_min', 'year_from', 'year_min', 'singleSelect'],
      ['year_max', 'year_to', 'year_max', 'singleSelect'],
      ['genre', 'genres', 'genre[]', 'multiSelect'],
    ])
      if (opts(name).length) result.push(select(key, `source_filter.${title}`, name, kind));
    if (!nsfw && opts('category[]').length)
      result.push({
        ...select('category', 'source_filter.category', 'category[]', 'multiSelect'),
        options: opts('category[]').filter((o) => !['6', '7'].includes(o.value)),
      });
    result.push(
      { id: 'episode_total', title: 'source_filter.episodes_from', kind: 'text' },
      { id: 'voice', title: 'source_filter.voice', kind: 'text' },
    );
    for (const [key, title, values] of [
      [
        'studio',
        'studio',
        opts('studio').filter(
          (o) => nsfw || !`${o.value} ${o.label}`.toLowerCase().includes('hentai'),
        ),
      ],
      ['age', 'age_rating', opts('age').filter((o) => nsfw || o.value !== '18')],
    ])
      if (values.length)
        result.push({
          id: key,
          title: `source_filter.${title}`,
          kind: 'singleSelect',
          options: [any, ...values],
        });
    if (nsfw && opts('censure').length)
      result.push(select('censure', 'source_filter.censure', 'censure'));
    if (opts('sort').length) result.push(select('sort', 'source_filter.sort', 'sort', 'sort'));
    if (opts('sort_by').length)
      result.push({
        ...select('sort_by', 'source_filter.direction', 'sort_by'),
        options: opts('sort_by'),
      });
    return (cachedFilters = result);
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const base = await origin(),
      filtered = text(searchTerm) || Object.keys(selectedFilters).length;
    let path, body;
    if (!filtered) path = `/${nsfw ? 'hentai' : 'anime'}/${page > 1 ? `page/${page}/` : ''}`;
    else {
      path = '/index.php?do=multisearch';
      const form = new URLSearchParams({
        do: 'multisearch',
        subaction: 'search',
        search_start: String(page),
        result_from: String((page - 1) * 10 + 1),
      });
      if (text(searchTerm)) form.set('title', text(searchTerm));
      for (const key of ['country', 'genre'])
        for (const value of array(selectedFilters[key]).map(text).filter(Boolean))
          form.append(`${key}[]`, value);
      for (const category of nsfw
        ? ['7']
        : array(selectedFilters.category).filter((v) => !['6', '7'].includes(v)))
        form.append('category[]', category);
      if (!nsfw) form.append('not_category[]', '7');
      for (const key of [
        'year_min',
        'year_max',
        'episode_total',
        'voice',
        'studio',
        'age',
        'censure',
      ])
        if (text(selectedFilters[key]?.[0])) form.set(key, selectedFilters[key][0]);
      form.set('sort', first(selectedFilters.sort?.[0], 'date'));
      form.set('sort_by', first(selectedFilters.sort_by?.[0], 'DESC'));
      if (text(selectedFilters.episode_total?.[0])) form.set('episode_difference', '');
      body = form.toString();
    }
    const data = object(
      await project(await request(path, { base, body }), {
        fields: {
          cards: { selector: 'article.story.shortstory', all: true, fields: cardFields },
          next: { selector: '.n_next a[href]', attr: 'href' },
          links: { selector: 'a[href]', all: true, attr: 'href' },
        },
      }),
    );
    return {
      items: dedupe(
        array(data.cards)
          .map((row) => item(row, base))
          .filter(Boolean),
        (row) => row.id,
      ).slice(0, 10),
      hasMore:
        !!data.next ||
        array(data.links).some((href) => normalize(href, base).includes(`/page/${page + 1}`)),
    };
  }
  async function playback(html, itemId, base) {
    const root = jsonObjectAfter(html, 'RalodePlayer.init(');
    if (!root) return [];
    const groups = [];
    for (const [groupId, raw] of Object.entries(root)) {
      const group = object(raw),
        entries = Object.entries(object(group.items)),
        codes = [];
      for (const [key, raw] of entries) {
        const row = object(raw);
        if (text(row.aname) && text(row.scode))
          codes.push({
            key,
            row,
            html: text(row.scode).replace(/\\\//g, '/').replace(/\\"/g, '"'),
          });
      }
      const projections = [];
      for (let offset = 0; offset < codes.length; offset += 200)
        projections.push(
          ...(await context.html.extractMany(
            codes.slice(offset, offset + 200).map((code) => code.html),
            { selector: 'iframe', attr: 'src' },
          )),
        );
      const episodes = codes
        .map((code, index) => {
          if (!projections[index]) return null;
          const row = code.row,
            link = new URL(projections[index], base).href;
          const url = new URL('anitokyo://player');
          url.searchParams.set('url', link);
          return {
            id: `${itemId}-${groupId}-${row.id ?? code.key}`,
            title: text(row.aname),
            number: /\d+(?:\.\d+)?/.exec(text(row.aname))?.[0] ?? text(row.aname),
            subtitle: text(row.sname),
            url: url.href,
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) => (Number(a.number) || Number.MAX_VALUE) - (Number(b.number) || Number.MAX_VALUE),
        );
      if (episodes.length)
        groups.push({
          id: `${itemId}-group-${groupId}`,
          playerId: 'anitokyo',
          playerLabel: 'Anitokyo',
          title: first(group.name, 'Озвучка'),
          subtitle: 'Anitokyo',
          episodes,
        });
    }
    return groups;
  }
  async function loadDetails({ itemId }) {
    let path;
    try {
      path = normalize(
        decodeURIComponent(itemId.startsWith(`${id}-`) ? itemId.slice(id.length + 1) : itemId),
        context.baseUrl,
      );
    } catch {
      return null;
    }
    if (
      !path ||
      path.split('/').some((part) => part === '..') ||
      (!nsfw && path.startsWith('hentai/'))
    )
      return null;
    const base = await origin(),
      html = await request(`/${path}.html`, { base });
    const data = object(
      await project(html, {
        fields: {
          title: { selector: 'h1.story-title, h1', text: true },
          poster: { selector: '.story-poster', fields: picture },
          overview: { selector: '.story-description', text: true },
          facts: infoQuery,
          related: {
            selector: '.related-carousel article.related-item',
            all: true,
            fields: cardFields,
          },
        },
      }),
    );
    if (!text(data.title)) return null;
    const meta = metadata(data.facts),
      poster = first(data.poster?.full, data.poster?.lazy, data.poster?.src),
      image = poster ? new URL(poster, base).href : '';
    const canonicalId = `${id}-${encodeURIComponent(path)}`;
    return {
      id: canonicalId,
      title: text(data.title),
      subtitle: meta
        .filter((row) => ['type', 'episodes'].includes(row.kind))
        .map((row) => row.value)
        .join(' / '),
      overview: text(data.overview).replace(/^Описание\s*:\s*/i, ''),
      kind: path.startsWith('movie/') ? 'movie' : 'anime',
      rating: 0,
      year: year(
        meta
          .filter((row) => row.kind === 'year')
          .map((row) => row.value)
          .join(' '),
      ),
      posterUrl: image,
      backdropUrl: image,
      isNsfw: nsfw,
      tags: meta.filter((row) => row.kind === 'genre').map((row) => row.value),
      metadata: meta,
      playbackGroups: await playback(html, canonicalId, base),
      relatedItems: dedupe(
        array(data.related)
          .map((row) => item(row, base))
          .filter(Boolean),
        (row) => row.id,
      ).slice(0, 24),
    };
  }
  async function resolveStream({ url }) {
    const input = new URL(url);
    if (input.protocol !== 'anitokyo:' || input.hostname !== 'player')
      throw fail('Invalid wrapper URL');
    const page = new URL(input.searchParams.get('url') ?? '');
    if (page.origin !== new URL(await origin()).origin || page.pathname !== '/video.php')
      throw fail('Invalid wrapper target', 'permission_denied');
    const html = await request(page.href),
      src = await project(html, { selector: 'iframe', attr: 'src' });
    if (!src) throw fail('Player provider is missing', 'stream_unavailable');
    const embedded = new URL(src, page).href;
    if (isKodik(embedded)) return kodik(embedded);
    const provider = new URL(embedded);
    if (provider.hostname !== 'hencdn.top' && !provider.hostname.endsWith('.hencdn.top'))
      throw fail('Unsupported provider', 'stream_unavailable');
    const providerHtml = await request(embedded, { base: provider.origin });
    const rows = await project(providerHtml, {
      selector: 'source[src]',
      all: true,
      fields: {
        src: { attr: 'src' },
        quality: { attr: 'res' },
        mime: { attr: 'type' },
        selected: { attr: 'selected' },
      },
    });
    const headers = { Referer: embedded, Origin: provider.origin };
    const variants = array(rows).map((row) => ({
      quality: first(row.quality, 'auto'),
      url: new URL(row.src, provider).href,
      mimeType: first(
        row.mime,
        new URL(row.src, provider).pathname.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp4',
      ),
      headers,
      isPreferred: row.selected === 'true',
    }));
    if (!variants.length) throw fail('Provider returned no native streams', 'stream_unavailable');
    let tracks = [];
    const raw = /\bsubtitles\s*:\s*(\[[\s\S]*?\])\s*,\s*(?:fonts|workerUrl)\s*:/i.exec(
      providerHtml,
    )?.[1];
    if (raw) {
      try {
        tracks = array(JSON.parse(raw));
      } catch {}
    }
    return {
      variants: dedupe(variants, (v) => `${v.url}|${v.quality}|${v.mimeType}`),
      subtitleTracks: dedupe(
        tracks
          .map((track) => {
            const file = first(track.src, track.url);
            if (!file) return null;
            const uri = new URL(file, provider),
              format = first(track.format, uri.pathname.split('.').at(-1)).toLowerCase();
            return {
              id: uri.href,
              label: first(track.label, track.language, 'Subtitles'),
              language: first(track.language, track.label),
              url: uri.href,
              mimeType: ['ass', 'ssa'].includes(format)
                ? 'text/x-ssa'
                : format === 'srt'
                  ? 'application/x-subrip'
                  : format === 'vtt'
                    ? 'text/vtt'
                    : '',
              headers,
              isDefault: track.default === true,
            };
          })
          .filter(Boolean),
        (track) => track.id,
      ),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    getPopular: (args) => search(args),
    getLatest: (args) => search(args),
    resolveStream,
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
  };
}
