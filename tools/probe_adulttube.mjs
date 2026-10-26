import createSource from '../sources/adulttube/src/index.mjs';

// Public, unauthenticated diagnostic. Never print cookies, signed URLs or HTML.
const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const base =
  process.argv.find((value) => value.startsWith('--base='))?.slice(7) || 'https://hot.mat6tube.com';
const ids = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const meta = (html, property) => {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((value) => [value[1], value[3]]),
    );
    if (attrs.property === property || attrs.name === property)
      return (attrs.content || '').replaceAll('&amp;', '&');
  }
  return '';
};
const source = createSource({
  baseUrl: base,
  settings: { network: async () => ({ baseUrl: '' }) },
  html: {
    extract: async (html) => ({
      fallback: meta(html, 'ya:ovs:content_url'),
      embed: meta(html, 'og:video'),
    }),
  },
  http: {
    request: async (request) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { 'User-Agent': browserUserAgent, ...request.headers },
        signal: AbortSignal.timeout(25000),
      });
      console.log(
        JSON.stringify({
          phase: request.method === 'HEAD' ? 'cdn-check' : 'page',
          origin: new URL(response.url).origin,
          status: response.status,
          type: response.headers.get('content-type'),
          challenge: response.headers.get('cf-mitigated') === 'challenge',
        }),
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error('HTTP ' + response.status), {
          code:
            response.headers.get('cf-mitigated') === 'challenge'
              ? 'challenge_required'
              : response.status === 403
                ? 'access_denied'
                : 'invalid_response',
          httpStatus: response.status,
        });
      }
      return {
        status: response.status,
        url: response.url,
        headers: Object.fromEntries(response.headers),
        body: request.method === 'HEAD' ? [] : await response.text(),
      };
    },
  },
});

for (const id of ids.length ? ids : ['-88674838_456242395', '-123198547_456239817']) {
  try {
    const result = await source.resolveStream({ url: base + '/watch/' + id });
    const variant = result.variants.find((value) => value.isPreferred) || result.variants[0];
    const response = await fetch(variant.url, {
      headers: {
        'User-Agent': browserUserAgent,
        ...variant.headers,
        Range: 'bytes=0-4095',
      },
      signal: AbortSignal.timeout(25000),
    });
    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const mp4 =
      Buffer.from(value || [])
        .subarray(4, 8)
        .toString('ascii') === 'ftyp';
    console.log(
      JSON.stringify({
        phase: 'media',
        id,
        status: response.status,
        type: response.headers.get('content-type'),
        range: response.headers.get('content-range'),
        mp4,
      }),
    );
    if (response.status !== 206 || !mp4) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ phase: 'failure', id, code: error.code, message: error.message }));
    process.exitCode = 1;
  }
}
