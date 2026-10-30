import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';
const meta = (property) => ({
  selector: `meta[property="${property}"],meta[name="${property}"]`,
  attr: 'content',
});
const imageFields = {
  fields: {
    lazy: { attr: 'data-src' },
    src: { attr: 'src' },
    fallback: { attr: 'data-fallback-src' },
    alt: { attr: 'alt' },
  },
};
const cardFields = {
  url: { selector: 'a.item_link', attr: 'href' },
  title: { selector: '.title', text: true },
  image: { selector: 'img', ...imageFields },
  duration: { selector: '.m_time', text: true },
  views: { selector: '.m_views', text: true },
};
const absolute = (value, base) => {
  if (!text(value)) return '';
  try {
    const uri = new URL(text(value), base);
    return ['http:', 'https:'].includes(uri.protocol) && !uri.username && !uri.password
      ? uri.href
      : '';
  } catch {
    return '';
  }
};
const pageSize = 24;
export function searchUrl(base, { searchTerm = '', selectedFilters = {} } = {}) {
  const term = text(searchTerm).normalize('NFC') || 'adult';
  if (term.length > 2048) throw fail('AdultTube search query is too long', 'invalid_argument');
  const url = new URL(base.replace(/\/+$/, '') + '/video/' + encodeURIComponent(term));
  const sort = text(selectedFilters.sort?.[0]),
    length = text(selectedFilters.len?.[0]);
  if (['0', '1'].includes(sort)) url.searchParams.set('sort', sort);
  if (['short', 'long'].includes(length)) url.searchParams.set('len', length);
  if (['true', '1'].includes(text(selectedFilters.hd?.[0]))) url.searchParams.set('hd', '1');
  return url;
}
const titleTags = (value) =>
  value
    .split(/[,/|]/)
    .map(text)
    .filter((v) => v.length > 2)
    .slice(0, 4);
export function watchPath(value) {
  if (!text(value)) return '';
  try {
    const path = new URL(value, 'https://wow.mat6tube.com').pathname;
    return /^\/watch\/[^/]+\/?$/.test(path) ? path : '';
  } catch {
    return '';
  }
}
const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60),
    s = String(seconds % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`
    : `${minutes}:${s}`;
};
function card(row, base) {
  const path = watchPath(row.url),
    title = first(row.title, row.image?.alt);
  if (!path || !title) return null;
  const poster =
    [row.image?.lazy, row.image?.src, row.image?.fallback]
      .map((value) => absolute(value, base))
      .find(Boolean) || '';
  return {
    id: 'adulttube-' + encodeURIComponent(path),
    webUrl: new URL(path, base).href,
    title,
    kind: 'movie',
    subtitle: [row.duration, row.views].map(text).filter(Boolean).join(' / '),
    posterUrl: poster,
    backdropUrl: poster,
    isNsfw: true,
    tags: titleTags(title),
  };
}
export async function streamVariants(context, html, headers) {
  const at = /window\.playlist\s*=\s*/.exec(html),
    playlist = at ? object(parseLiteral(html, at.index + at[0].length)) : {},
    data = object(
      await context.html.extract(html, {
        fields: { fallback: meta('ya:ovs:content_url'), embed: meta('og:video') },
      }),
    );
  const rows = array(playlist.sources),
    fallback = text(data.fallback);
  let fallbackUri;
  try {
    fallbackUri = new URL(fallback);
  } catch {}
  if (
    fallbackUri &&
    !(
      fallbackUri.hostname.endsWith('mat6tube.com') &&
      fallbackUri.pathname.startsWith('/videofile/')
    )
  )
    rows.push({ file: fallback });
  const variants = dedupe(
      rows
        .filter((v) => /^https:\/\//.test(text(v.file)))
        .map((row) => {
          const uri = new URL(row.file),
            mime = /\.m3u8$/i.test(uri.pathname)
              ? 'application/vnd.apple.mpegurl'
              : /\.mp4$/i.test(uri.pathname) ||
                  /(?:^|\.)(?:okcdn\.ru|noodlemagazine\.com|pvvstream\.pro)$/.test(uri.hostname) ||
                  text(row.type).includes('mp4')
                ? 'video/mp4'
                : '';
          return {
            quality:
              /\d{3,4}/.exec(text(row.label))?.[0] ??
              /\/(\d{3,4})\//.exec(uri.pathname)?.[1] ??
              'auto',
            url: uri.href,
            refreshBeforePlay: uri.searchParams.has('secure'),
            mimeType: mime,
            // Native media uses the host's default browser identity.
            headers: uri.hostname.endsWith('.noodlemagazine.com') ? {} : headers,
          };
        })
        .filter((v) => v.mimeType),
      (v) => v.quality,
    ),
    highest = Math.max(0, ...variants.map((v) => Number(v.quality) || 0));
  return {
    variants: variants.map((v) => ({ ...v, isPreferred: (Number(v.quality) || 0) === highest })),
    embed: text(data.embed),
  };
}
export default function createSource(context) {
  const origin = async () =>
    ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  async function requestPage(url, { referer, body, csrf } = {}) {
    const response = await context.http.request({
      method: body ? 'POST' : 'GET',
      url,
      responseType: 'text',
      userAgentProfile: 'browser',
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: referer || (await origin()) + '/recent',
        ...(body
          ? {
              Origin: new URL(url).origin,
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
            }
          : {}),
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    });
    return { html: text(response.body), url: response.url || url };
  }
  const request = async (url, options) => (await requestPage(url, options)).html;
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, Math.trunc(Number(page)) || 1);
    const base = await origin(),
      url = searchUrl(base, { searchTerm, selectedFilters });
    let response = await requestPage(url.href, { referer: base + '/recent' });
    if (page > 1) {
      const csrf = text(
        await context.html.extract(
          response.html,
          {
            selector: 'input[name="csrfmiddlewaretoken"]',
            attr: 'value',
          },
          response.url,
        ),
      );
      if (!csrf) throw fail('AdultTube search pagination token was not found');
      response = await requestPage(response.url, {
        referer: response.url,
        csrf,
        body: {
          ...Object.fromEntries(url.searchParams),
          csrfmiddlewaretoken: csrf,
          p: String(page - 1),
        },
      });
    }
    const data = object(
        await context.html.extract(
          response.html,
          {
            fields: {
              cards: { selector: '.item', all: true, fields: cardFields },
              more: { selector: '.more', attr: 'data-page' },
            },
          },
          response.url,
        ),
      ),
      items = dedupe(
        array(data.cards)
          .map((row) => card(row, response.url))
          .filter(Boolean),
        (v) => v.id,
      );
    return {
      items,
      hasMore:
        items.length > 0 && (Boolean(text(data.more)) || array(data.cards).length >= pageSize),
    };
  }
  async function loadDetails({ itemId }) {
    const path = watchPath(
      decodeURIComponent(itemId.startsWith('adulttube-') ? itemId.slice(10) : itemId),
    );
    if (!path) return null;
    const base = await origin(),
      html = await request(base + path),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: meta('og:title'),
            heading: { selector: 'h1', text: true },
            poster: meta('og:image'),
            overview: meta('og:description'),
            duration: meta('video:duration'),
            related: { selector: '#list_videos .item', all: true, fields: cardFields },
          },
        }),
      ),
      title = first(data.title, data.heading);
    if (!title) return null;
    const poster = absolute(data.poster, base),
      duration = Number(data.duration) || null;
    return {
      id: 'adulttube-' + encodeURIComponent(path),
      webUrl: new URL(path, base).href,
      title,
      kind: 'movie',
      subtitle: duration == null ? '' : formatDuration(duration),
      overview: text(data.overview),
      posterUrl: poster,
      backdropUrl: poster,
      isNsfw: true,
      tags: titleTags(title),
      playbackGroups: [
        {
          id: `${itemId}-player`,
          playerId: 'adultTube',
          playerLabel: 'AdultTube',
          title: 'AdultTube',
          subtitle: 'Direct MP4',
          episodes: [
            {
              id: `${itemId}-video`,
              title,
              number: '1',
              url: base + path,
              durationSeconds: duration,
            },
          ],
        },
      ],
      relatedItems: dedupe(
        array(data.related)
          .map((row) => card(row, base))
          .filter((v) => v && v.id !== itemId),
        (v) => v.id,
      ).slice(0, 48),
    };
  }
  async function resolveStream({ url }) {
    const uri = new URL(url),
      base = await origin();
    const sitePage =
      uri.origin === new URL(base).origin ||
      uri.hostname === 'mat6tube.com' ||
      uri.hostname.endsWith('.mat6tube.com');
    if (
      !(
        (sitePage && watchPath(uri.href)) ||
        (uri.hostname === 'nmcorp.video' && uri.pathname.startsWith('/player/'))
      ) ||
      uri.username ||
      uri.password
    )
      throw fail('Unsupported AdultTube URL');
    const headers = { Referer: base + '/' },
      html = await request(url, { referer: base + '/recent' });
    let result = await streamVariants(context, html, headers);
    if (!result.variants.length && result.embed) {
      const embed = new URL(result.embed);
      if (embed.hostname === 'nmcorp.video' && embed.pathname.startsWith('/player/'))
        result = await streamVariants(
          context,
          await request(embed.href, { referer: url }),
          headers,
        );
    }
    if (!result.variants.length)
      throw fail('AdultTube player has no playable files', 'stream_unavailable');
    // The host media broker owns CDN access. A HEAD request from the JS HTTP
    // transport can be challenged even when the browser media transport works.
    return { variants: result.variants };
  }
  return {
    getFilters: () => [
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        options: [
          { value: '2', label: 'source_filter.sort.relevance' },
          { value: '0', label: 'source_filter.sort.new' },
          { value: '1', label: 'source_filter.sort.longest' },
        ],
        defaultValues: ['2'],
        isAvailableWithSearchTerm: true,
      },
      {
        id: 'len',
        title: 'Duration',
        kind: 'singleSelect',
        defaultValues: ['any'],
        isAvailableWithSearchTerm: true,
        options: [
          { value: 'any', label: 'source_filter.any' },
          { value: 'short', label: 'Short' },
          { value: 'long', label: 'Long' },
        ],
      },
      { id: 'hd', title: 'HD only', kind: 'toggle', isAvailableWithSearchTerm: true },
    ],
    getPopular: (args = {}) => search(args),
    getLatest: ({ selectedFilters = {}, ...args } = {}) =>
      search({
        ...args,
        selectedFilters: { ...selectedFilters, sort: [first(selectedFilters.sort?.[0], '0')] },
      }),
    search,
    loadDetails,
    resolveStream,
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
