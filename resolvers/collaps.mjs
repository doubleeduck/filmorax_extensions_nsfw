import { text, array, object, first, fail, dedupe, jsonProperty } from '../sdk/video.mjs';
import { literalProperty } from '../sdk/literal.mjs';
export const collapsHosts = [
  'nextembed.ws',
  'ortified.ws',
  'femd.ws',
  'delivembed.cc',
  'embedstorage.net',
  'buildplayer.com',
  'multikland.net',
  'stiven-king.com',
];
export function isCollaps(input) {
  try {
    const uri = new URL(input);
    return (
      (uri.protocol === 'collaps:' && uri.hostname === 'embed') ||
      (uri.protocol === 'https:' &&
        uri.pathname.startsWith('/embed/') &&
        collapsHosts.some((host) => uri.hostname === host || uri.hostname.endsWith('.' + host)))
    );
  } catch {
    return false;
  }
}
export function createCollaps(context) {
  async function load(value) {
    const input = new URL(value),
      embed = new URL(input.protocol === 'collaps:' ? input.searchParams.get('url') : value);
    if (!isCollaps(embed.href) || embed.protocol !== 'https:')
      throw fail('Unsupported Collaps embed');
    const referer = input.searchParams.get('referer') ?? '';
    const html = text(
      (
        await context.http.request({
          method: 'GET',
          url: embed.href,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: { Accept: 'text/html', ...(referer ? { Referer: referer } : {}) },
        })
      ).body,
    );
    const at = /makePlayer\s*\(\s*\{/.exec(html)?.index ?? -1,
      source = at < 0 ? html : html.slice(at),
      seasons = array(literalProperty(source, 'seasons') ?? jsonProperty(source, 'seasons')),
      episodes = [];
    for (const season of seasons)
      if (season.blocked !== true)
        for (const episode of array(season.episodes))
          if (episode.blocked !== true)
            episodes.push({
              season: text(season.season),
              number: text(episode.episode),
              data: object(episode),
            });
    if (!episodes.length && !seasons.length) {
      const data = object(literalProperty(source, 'source') ?? jsonProperty(source, 'source'));
      if (Object.keys(data).length) episodes.push({ season: '', number: '', data });
    }
    const suffix =
      /\bvar\s+lok\s*=\s*\d+\s*,\s*\w+\s*=\s*["']([a-f0-9]+)["']/.exec(html)?.[1] ?? '';
    return { input, embed, referer, episodes, suffix };
  }
  async function resolve(value) {
    const { input, embed, episodes, suffix } = await load(value),
      season = input.searchParams.get('season') ?? '',
      episode = input.searchParams.get('episode') ?? '';
    const matches =
      !season && !episode
        ? episodes.slice(0, 1)
        : episodes.filter(
            (row) => (!season || row.season === season) && (!episode || row.number === episode),
          );
    if (matches.length !== 1)
      throw fail('Collaps episode is missing or ambiguous', 'episode_not_found');
    const data = matches[0].data,
      headers = { Referer: embed.href, Origin: embed.origin },
      variants = [];
    for (const key of ['hls', 'dash', 'dasha', 'download']) {
      const raw = text(data[key]);
      if (!raw) continue;
      const uri = new URL(raw, embed),
        path = uri.pathname.toLowerCase();
      if (uri.protocol !== 'https:' || !/\.(?:m3u8|mpd|mp4)$/.test(path)) continue;
      const url = uri.href + (suffix ? (uri.search ? '&' : '?') + suffix : '');
      variants.push({
        quality: 'auto',
        url,
        headers,
        mimeType: path.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : path.endsWith('.mpd')
            ? 'application/dash+xml'
            : 'video/mp4',
        isPreferred: key === 'hls',
      });
    }
    if (!variants.length) throw fail('Collaps episode has no streams', 'stream_unavailable');
    return {
      variants: dedupe(variants, (row) => `${row.url}|${row.mimeType}`),
      subtitleTracks: dedupe(
        array(data.cc)
          .filter((row) => text(row.url))
          .map((row) => {
            const url = new URL(row.url, embed).href;
            return { id: text(row.url), label: first(row.name, 'Subtitles'), url, headers };
          }),
        (row) => row.id,
      ),
    };
  }
  async function groups(value) {
    const { embed, referer, episodes } = await load(value);
    if (!episodes.length) return [];
    const id = embed.pathname.split('/').filter(Boolean).at(-1);
    return [
      {
        id: `collaps-${id}`,
        playerId: 'collaps',
        playerLabel: 'Collaps',
        title: 'Collaps',
        episodes: [...episodes]
          .sort(
            (a, b) =>
              (Number(a.season) || 0) - (Number(b.season) || 0) ||
              (Number(a.number) || 0) - (Number(b.number) || 0),
          )
          .map((row) => {
            const uri = new URL('collaps://embed');
            uri.searchParams.set('url', embed.href);
            if (referer) uri.searchParams.set('referer', referer);
            uri.searchParams.set('season', row.season);
            uri.searchParams.set('episode', row.number);
            const duration = Number(row.data.duration);
            return {
              id: `collaps-${id}-${row.season}-${row.number}`,
              title: first(row.data.title, 'action.watch'),
              number: row.number,
              season: row.season,
              ...(Number.isInteger(duration) && duration >= 0 ? { durationSeconds: duration } : {}),
              url: uri.href,
            };
          }),
      },
    ];
  }
  return { resolve, groups };
}
