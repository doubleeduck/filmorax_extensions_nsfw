import { text, array, object, first, fail, dedupe, queryUrl } from '../sdk/video.mjs';
const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
export function isCdnVideoHub(value) {
  try {
    const uri = new URL(value);
    return (
      uri.protocol === 'https:' &&
      (uri.hostname.includes('cdnvideohub') ||
        uri.pathname.toLowerCase() === '/iframecvh.html' ||
        uri.pathname.includes('/cdn-iframe/'))
    );
  } catch {
    return false;
  }
}
export function createCdnVideoHub(context) {
  const get = async (url, headers = {}, type = 'json') =>
    (
      await context.http.request({
        method: 'GET',
        url,
        responseType: type,
        headers,
        userAgentProfile: 'browser',
      })
    ).body;
  return async (value) => {
    const uri = new URL(value);
    if (!isCdnVideoHub(value)) throw fail('Unsupported CDN provider');
    const origin = uri.hostname.includes('animego')
      ? 'https://animego.me'
      : uri.hostname.includes('yummyani')
        ? 'https://ru.yummyani.me'
        : uri.hostname === 'plapi.cdnvideohub.com'
          ? ''
          : uri.origin;
    const headers = {
      Accept: 'application/json, text/plain, */*',
      ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
    };
    let vkId =
      uri.hostname === 'plapi.cdnvideohub.com' && uri.pathname.includes('/api/v1/player/sv/video/')
        ? uri.pathname.split('/').at(-1)
        : '';
    if (!vkId) {
      let data;
      if (uri.pathname.toLowerCase() === '/iframecvh.html') {
        if (!uri.hostname.includes('yummyani')) throw fail('Unsupported CDN iframe host');
        data = {
          titleId: uri.searchParams.get('anime_id'),
          season: uri.searchParams.get('season'),
          episode: uri.searchParams.get('episode'),
          voice: uri.searchParams.get('dubbing_code'),
          publisher: '745',
          aggregator: 'mali',
        };
        if (!data.titleId || !data.episode || !data.voice) throw fail('Incomplete CDN iframe');
      } else if (uri.pathname.includes('/cdn-iframe/')) {
        if (!uri.hostname.includes('animego')) throw fail('Unsupported CDN iframe host');
        const parts = uri.pathname.split('/').filter(Boolean),
          at = parts.indexOf('cdn-iframe');
        data = {
          titleId: parts[at + 1],
          voice: decodeURIComponent(parts[at + 2] ?? ''),
          season: parts[at + 3],
          episode: parts[at + 4],
          publisher: '747',
          aggregator: 'mali',
        };
        if (!data.titleId || !data.episode || !data.voice) throw fail('Incomplete CDN iframe');
      } else {
        const html = text(await get(value, headers, 'text')),
          tag = object(
            await context.html.extract(html, {
              selector: 'video-player',
              fields: {
                id: { attr: 'id' },
                title: { attr: 'data-title-id' },
                publisher: { attr: 'data-publisher-id' },
                aggregator: { attr: 'data-aggregator' },
                season: { attr: 'season' },
                episode: { attr: 'episode' },
                voice: { attr: 'priority-voice' },
              },
            }),
          );
        data = {
          titleId: /^(?:\d+$|[0-9a-f]{8,})/i.test(text(tag.id))
            ? text(tag.id)
            : first(tag.title, tag.id),
          publisher: text(tag.publisher),
          aggregator: text(tag.aggregator),
          season: tag.season,
          episode: tag.episode,
          voice: decodeURIComponent(text(tag.voice)),
        };
        if (!data.titleId || !data.publisher || !data.aggregator) throw fail('Incomplete CDN page');
      }
      const playlistData = object(
        await get(
          queryUrl(api + '/', api + '/playlist', {
            pub: data.publisher,
            aggr: data.aggregator,
            id: data.titleId,
          }),
          headers,
        ),
      );
      const playlist = array(playlistData.items),
        movie = playlistData.isSerial === false;
      if (
        movie &&
        ((text(data.episode) && Number(data.episode) !== 1) ||
          (text(data.season) && Number(data.season) > 1))
      )
        throw fail('CDN movie does not contain this episode', 'episode_not_found');
      const matching = playlist.filter(
        (row) =>
          (movie || !text(data.episode) || Number(row.episode) === Number(data.episode)) &&
          (movie || !text(data.season) || Number(row.season) === Number(data.season)) &&
          (!text(data.voice) || text(row.voiceStudio) === data.voice),
      );
      if (
        text(data.episode) &&
        !text(data.season) &&
        new Set(matching.map((row) => text(row.season))).size > 1
      )
        throw fail('CDN season is required', 'episode_not_found');
      vkId = text(matching.find((row) => text(row.vkId))?.vkId);
      if (!vkId) throw fail('Matching CDN video was not found', 'episode_not_found');
    }
    const sources = object(
        object(await get(`${api}/video/${encodeURIComponent(vkId)}`, headers)).sources,
      ),
      variants = [];
    const mapping = {
      mpegTinyUrl: 144,
      mpegLowestUrl: 240,
      mpegLowUrl: 360,
      mpegMediumUrl: 480,
      mpegHighUrl: 720,
      mpegFullHdUrl: 1080,
      mpegQhdUrl: 1440,
      mpeg2kUrl: 2048,
      mpeg4kUrl: 4096,
    };
    for (const [key, value] of Object.entries(sources)) {
      const quality = mapping[key] ?? (/^url/i.test(key) ? Number(/\d{3,4}/.exec(key)?.[0]) : 0);
      if (!quality || !text(value)) continue;
      variants.push({ quality: String(quality), url: text(value), mimeType: 'video/mp4' });
    }
    if (text(sources.hlsUrl))
      variants.push({
        quality: 'auto',
        url: text(sources.hlsUrl),
        mimeType: 'application/vnd.apple.mpegurl',
        isPreferred: true,
      });
    const dash = first(sources.dashUrl, sources.dashManifestUrl);
    if (dash) variants.push({ quality: 'auto', url: dash, mimeType: 'application/dash+xml' });
    if (!variants.length) throw fail('CDN has no native sources', 'stream_unavailable');
    return { variants: dedupe(variants, (row) => row.url), subtitleTracks: [] };
  };
}
