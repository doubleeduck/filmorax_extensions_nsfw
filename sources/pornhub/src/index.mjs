import { array, dedupe, fail, first, object, text } from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';

const viewKey = /^[a-z\d]{6,64}$/i;
const categoryId = /^[1-9]\d{0,5}$/;
const siteHost = /(?:^|\.)pornhub\.com$/i;
const cdnHost = /(?:^|\.)phncdn\.com$/i;
const siteSorts = new Map([
  ['mr', 'source_filter.sort.new'],
  ['mv', 'source_filter.sort.views'],
  ['tr', 'source_filter.sort.rating'],
  ['lg', 'source_filter.sort.longest'],
]);
const cardSelector = 'li.videoblock[data-video-vkey]';
const cardFields = {
  key: { attr: 'data-video-vkey' },
  title: { selector: '.title a', text: true },
  titleHint: { selector: '.title a', attr: 'title' },
  thumbnail: { selector: '.phimage img, img.thumb', attr: 'data-thumb_url' },
  lazy: { selector: '.phimage img, img.thumb', attr: 'data-src' },
  image: { selector: '.phimage img, img.thumb', attr: 'src' },
  duration: { selector: '.duration', text: true },
  views: { selector: '.views', text: true },
};
const meta = (property) => ({ selector: `meta[property="${property}"]`, attr: 'content' });

function httpsUrl(value, base) {
  if (!text(value) || /[\\\x00-\x20\x7f]/.test(value)) return null;
  try {
    const uri = new URL(value, base);
    if (uri.protocol === 'https:' && !uri.port && !uri.username && !uri.password && !uri.hash)
      return uri;
  } catch {}
  return null;
}
const keyFromUrl = (value) => {
  const uri = httpsUrl(value);
  const key = uri?.searchParams.get('viewkey');
  return uri &&
    siteHost.test(uri.hostname) &&
    uri.pathname === '/view_video.php' &&
    viewKey.test(key ?? '')
    ? key
    : '';
};
const videoUrl = (base, key) => new URL('/view_video.php?viewkey=' + key, base).href;
function posterUrl(base, ...values) {
  for (const value of values) {
    const uri = httpsUrl(value, base);
    if (uri && (cdnHost.test(uri.hostname) || siteHost.test(uri.hostname))) return uri.href;
  }
  return '';
}
function cards(rows, base, excluded = '') {
  return dedupe(
    array(rows).flatMap((row) => {
      const key = text(row.key);
      const title = first(row.title, row.titleHint);
      if (!viewKey.test(key) || !title || key === excluded) return [];
      const poster = posterUrl(base, row.thumbnail, row.lazy, row.image);
      return [
        {
          id: 'pornhub-' + key,
          title,
          webUrl: videoUrl(base, key),
          posterUrl: poster,
          backdropUrl: poster,
          subtitle: [row.duration, row.views].map(text).filter(Boolean).join(' • '),
          kind: 'movie',
          isNsfw: true,
        },
      ];
    }),
    (row) => row.id,
  );
}

function playerData(html) {
  const match = /\bflashvars_\d+\s*=\s*(?=\{)/.exec(html);
  return match ? object(parseLiteral(html, match.index + match[0].length)) : {};
}
const isUnavailable = (player) =>
  [player.video_unavailable, player.video_unavailable_country].some(
    (value) => value === true || value === 'true',
  );

export default function createSource(context) {
  const base = context.baseUrl;
  let categories;
  async function request(url, responseType = 'text', referer = base + '/', timeoutMs = 12000) {
    const target = new URL(url, base).href;
    const response = await context.http.request({
      method: 'GET',
      url: target,
      responseType,
      timeoutMs,
      headers: {
        Accept: responseType === 'json' ? 'application/json' : 'text/html',
        Referer: referer,
      },
    });
    const finalUrl = httpsUrl(response.url || target);
    if (!finalUrl || !siteHost.test(finalUrl.hostname))
      throw fail('Pornhub redirected outside its site', 'invalid_response');
    return response;
  }
  async function getFilters({ refresh = false } = {}) {
    if (!categories || refresh) {
      const page = await request('/categories');
      const rows = await context.html.extract(
        text(page.body),
        {
          selector: '.categoriesListSection .catPic[data-category]',
          all: true,
          fields: {
            id: { attr: 'data-category' },
            title: { selector: '.categoryTitleWrapper a', text: true },
          },
        },
        page.url || base,
      );
      categories = dedupe(
        array(rows)
          .map((row) => ({ value: text(row.id), label: text(row.title) }))
          .filter((row) => categoryId.test(row.value) && row.label),
        (row) => row.value,
      );
    }
    return [
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        isAvailableWithSearchTerm: true,
        options: [
          { value: '', label: 'source_filter.any' },
          ...[...siteSorts].map(([value, label]) => ({ value, label })),
        ],
      },
      ...(categories.length
        ? [
            {
              id: 'category',
              title: 'source_filter.genre',
              kind: 'singleSelect',
              options: [{ value: '', label: 'source_filter.any' }, ...categories],
            },
          ]
        : []),
    ];
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, Math.trunc(Number(page)) || 1);
    const term = text(searchTerm);
    const url = new URL(term ? '/video/search' : '/video', base);
    const sort = text(selectedFilters.sort?.[0]);
    const category = text(selectedFilters.category?.[0]);
    if (term) url.searchParams.set('search', term);
    else if (categoryId.test(category)) url.searchParams.set('c', category);
    if (siteSorts.has(sort)) url.searchParams.set('o', sort);
    if (page > 1) url.searchParams.set('page', String(page));
    const response = await request(url.href);
    const pageUrl = response.url || url.href;
    const data = object(
      await context.html.extract(
        text(response.body),
        {
          fields: {
            cards: { selector: cardSelector, all: true, fields: cardFields },
            next: { selector: '.page_next a[href]', attr: 'href' },
          },
        },
        pageUrl,
      ),
    );
    const items = cards(data.cards, pageUrl);
    const next = httpsUrl(data.next, pageUrl);
    return {
      items,
      hasMore:
        items.length > 0 &&
        !!next &&
        siteHost.test(next.hostname) &&
        Number(next.searchParams.get('page')) === page + 1,
    };
  }
  async function loadDetails({ itemId } = {}) {
    const key = /^pornhub-([a-z\d]{6,64})$/i.exec(text(itemId))?.[1];
    if (!key) return null;
    const url = videoUrl(base, key);
    const response = await request(url);
    const page = response.url || url;
    const html = text(response.body);
    const player = playerData(html);
    const data = object(
      await context.html.extract(
        html,
        {
          fields: {
            title: meta('og:title'),
            heading: { selector: 'h1', text: true },
            poster: meta('og:image'),
            description: meta('og:description'),
            duration: meta('video:duration'),
            related: {
              selector: '#relatedVideosListing ' + cardSelector,
              all: true,
              fields: cardFields,
            },
          },
        },
        page,
      ),
    );
    const title = first(data.heading, player.video_title, data.title);
    if (!title) return null;
    const poster = posterUrl(page, data.poster, player.image_url);
    const duration = Number(first(player.video_duration, data.duration));
    return {
      id: itemId,
      title,
      webUrl: page,
      posterUrl: poster,
      backdropUrl: poster,
      overview: text(data.description),
      kind: 'movie',
      isNsfw: true,
      playbackGroups:
        isUnavailable(player) || !array(player.mediaDefinitions).length
          ? []
          : [
              {
                id: itemId + '-player',
                playerId: 'pornhub',
                playerLabel: 'Pornhub',
                title: 'Pornhub',
                episodes: [
                  {
                    id: itemId + '-video',
                    title,
                    url,
                    number: '1',
                    ...(Number.isInteger(duration) && duration > 0 && duration <= 604800
                      ? { durationSeconds: duration }
                      : {}),
                  },
                ],
              },
            ],
      relatedItems: cards(data.related, page, key).slice(0, 24),
    };
  }
  async function resolveStream({ url } = {}) {
    const key = keyFromUrl(url);
    if (!key) throw fail('Unsupported Pornhub video URL');
    const target = videoUrl(base, key);
    const response = await request(target);
    const page = response.url || target;
    const player = playerData(text(response.body));
    if (isUnavailable(player))
      throw fail('Pornhub reports this video as unavailable', 'access_denied');
    const definitions = array(player.mediaDefinitions);
    const variants = [];
    const add = (row) => {
      const uri = httpsUrl(row?.videoUrl, page);
      if (!uri || !cdnHost.test(uri.hostname)) return;
      const path = uri.pathname.toLowerCase();
      const mimeType = path.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : path.endsWith('.mp4')
          ? 'video/mp4'
          : '';
      if (!mimeType) return;
      const quality = text(row.quality);
      variants.push({
        url: uri.href,
        mimeType,
        quality: /^\d{2,4}p?$/i.test(quality) ? quality.replace(/p$/i, '') : 'auto',
        isPreferred: row.defaultQuality === true,
        headers: { Referer: page },
      });
    };
    for (const row of definitions) add(row);
    const apiUrl = definitions
      .filter((row) => row?.format === 'mp4')
      .map((row) => httpsUrl(row.videoUrl, page))
      .find((uri) => uri?.origin === new URL(page).origin && uri.pathname === '/video/get_media');
    if (apiUrl && !variants.some((row) => row.mimeType === 'video/mp4')) {
      try {
        const result = await request(apiUrl.href, 'json', page, 3000);
        for (const row of array(result.body)) add(row);
      } catch (error) {
        if (
          !variants.length ||
          ['cancelled', 'permission_denied', 'resource_limit'].includes(error?.code)
        )
          throw error;
      }
    }
    if (!variants.length)
      throw fail('Pornhub did not provide a playable stream', 'stream_unavailable');
    return { variants: dedupe(variants, (row) => row.url) };
  }
  return {
    search,
    getFilters,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 } = {}) => search({ page, selectedFilters: { sort: ['mv'] } }),
    getLatest: ({ page = 1 } = {}) => search({ page, selectedFilters: { sort: ['mr'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async ({ itemId, url } = {}) =>
      !itemId && !keyFromUrl(url)
        ? []
        : ((await loadDetails({ itemId: itemId || 'pornhub-' + keyFromUrl(url) }))
            ?.playbackGroups ?? []),
  };
}
