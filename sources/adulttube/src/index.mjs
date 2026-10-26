import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';
const meta = (property) => ({
  selector: `meta[property="${property}"],meta[name="${property}"]`,
  attr: 'content',
});
const imageFields = {
  fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
};
const cardFields = {
  url: { selector: 'a.item_link', attr: 'href' },
  title: { selector: '.title', text: true },
  image: { selector: 'img', ...imageFields },
  duration: { selector: '.m_time', text: true },
  views: { selector: '.m_views', text: true },
};
const absolute = (value, base) => (text(value) ? new URL(value, base).href : '');
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
  const poster = absolute(first(row.image?.lazy, row.image?.src), base);
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
            headers,
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
  async function request(url, { referer, body, csrf } = {}) {
    return text(
      (
        await context.http.request({
          method: body ? 'POST' : 'GET',
          url,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: {
            Accept: 'text/html',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            Referer: referer || (await origin()) + '/recent',
            Origin: await origin(),
            ...(body
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-Requested-With': 'XMLHttpRequest',
                }
              : {}),
            ...(csrf ? { 'X-CSRFToken': csrf } : {}),
          },
          ...(body ? { body: new URLSearchParams(body).toString() } : {}),
        })
      ).body,
    );
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const term = text(searchTerm) || 'adult';
    const base = await origin(),
      url = new URL(base + '/video/' + encodeURIComponent(term)),
      sort = text(selectedFilters.sort?.[0]);
    if (sort && sort !== '2') url.searchParams.set('sort', sort);
    let html = await request(url.href, { referer: base + '/recent' });
    if (page > 1) {
      const csrf = text(
        await context.html.extract(html, {
          selector: 'input[name="csrfmiddlewaretoken"]',
          attr: 'value',
        }),
      );
      html = await request(url.href, {
        referer: url.href,
        csrf,
        body: { ...(csrf ? { csrfmiddlewaretoken: csrf } : {}), p: String(page - 1) },
      });
    }
    const data = object(
        await context.html.extract(html, {
          fields: {
            cards: { selector: '.item', all: true, fields: cardFields },
            more: { selector: '.more', text: true },
          },
        }),
      ),
      items = dedupe(
        array(data.cards)
          .map((row) => card(row, base))
          .filter(Boolean),
        (v) => v.id,
      ).slice(0, 24);
    return { items, hasMore: Boolean(text(data.more)) || items.length >= 24 };
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
    if (!(
      (uri.origin === base && watchPath(uri.href)) ||
      (uri.hostname === 'nmcorp.video' && uri.pathname.startsWith('/player/'))
    ))
      throw fail('Unsupported AdultTube URL');
    const headers = { Referer: base + '/', Origin: base },
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
    return { variants: result.variants };
  }
  return {
    getFilters: () => [
      {
        id: 'sort',
        title: 'Sort by',
        kind: 'sort',
        options: [
          { value: '2', label: 'Relevance' },
          { value: '0', label: 'Date added' },
          { value: '1', label: 'Duration' },
        ],
        defaultValues: ['2'],
      },
    ],
    getPopular: ({ page = 1 } = {}) => search({ page }),
    getLatest: ({ page = 1 } = {}) => search({ page, selectedFilters: { sort: ['0'] } }),
    search,
    loadDetails,
    resolveStream,
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
