# FilmoraX extensions: developer guide

[Русский](extensions.ru.md)

An extension is a signed `.fxextension` package. It can provide one or more
catalog sources or enable an application feature that is already supported.
A source contains a JavaScript ES module, a manifest, a license, and local images.
A feature package declares capabilities. Extensions cannot install arbitrary
interfaces or operating-system executables.

## 1. Repository and tools

Use Node.js 22 or newer and work in an extension repository:

- `fx_extensions`: regular sources and the TorrServer feature package;
- `nsfw_fx_extensions`: adult sources.

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm test
npm run format:check
```

Public API types are in `sdk/index.d.ts`; `examples/demo/` is a complete offline
example. Shared helpers belong in `sdk/`, site engines in `engines/`, and video
provider parsers in `resolvers/`. Reuse these instead of copying implementations
between sources. Imports are bundled: files from a neighboring repository are
not available when an installed package runs.

Create the following structure:

```text
sources/my_catalog/
  manifest.json
  LICENSE
  assets/icon.png
  src/index.mjs
tests/my_catalog.test.mjs
```

Use your own stable package, source, group, and episode IDs. They must not depend
on a mirror, token, or request time. Add the source ID to
`repository.json.sourceIds`. In a new repository, list only the sources and
features you actually publish and set your own `publisherKeyId`.

## 2. Source manifest

This example targets a hypothetical JSON API. The `example.org` addresses are
placeholders, not a ready-to-use catalog. Replace them with your service's
addresses and supply `LICENSE` and a PNG.

```json
{
  "schemaVersion": 1,
  "sourceApiVersion": 1,
  "minRuntimeAbi": 1,
  "id": "example.source.catalog",
  "name": "My Catalog",
  "description": "Catalog, filters, episodes and video streams",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "publisherKeyId": "example.publisher",
  "icon": "assets/icon.png",
  "entrypoint": "src/index.mjs",
  "permissions": ["http", "html"],
  "sources": [{
    "id": "example.catalog",
    "name": "My Catalog",
    "description": "Films and series",
    "language": "english",
    "category": "movies",
    "baseUrl": "https://catalog.example.org",
    "isNsfw": false,
    "supportsTorrentSearch": false,
    "capabilities": ["catalog", "search", "filters", "metadata", "playbackGroups", "streams"],
    "parameters": {},
    "presentation": {
      "icon": "assets/icon.png",
      "directPlayback": false,
      "artworkLayout": "portrait"
    },
    "network": {
      "origins": ["https://catalog.example.org"],
      "imageOrigins": ["https://images.example.org"],
      "streamOrigins": ["https://video.example.org"],
      "methods": ["GET"],
      "maxConcurrentRequests": 4,
      "allowUserBaseUrl": true,
      "userBaseUrlUses": ["image", "stream"]
    }
  }],
  "resolvers": [{
    "id": "example.catalog.streams",
    "sourceId": "example.catalog",
    "schemes": ["examplecatalog"],
    "origins": []
  }],
  "contributions": {"hostFeatures": []},
  "files": {}
}
```

The packer fills `files`, sizes, hashes, and the signature. Do not edit a signed
archive. Icons must be local, static PNG files, at most 256 KiB and 512×512,
covered by the signature. Record image provenance and respect its license.

Declare only capabilities that you implement:

| Capability | Required methods and behavior |
| --- | --- |
| Every source | `loadDetails({itemId})`; return `null` for an unknown ID |
| `catalog` | `getPopular({page})` and `getLatest({page})` |
| `search` | `search({page, searchTerm, selectedFilters})` |
| `filters` | `getFilters({refresh})` |
| `playbackGroups` | `loadPlaybackGroups({itemId, url})`; `[]` if details already contain groups |
| `streams` | `resolveStream({url})` and a matching `resolvers` declaration |
| `recommendations` | `getRecommendations({itemId})` |
| `metadataOnly` | Metadata source without `streams` |

`language` accepts `international`, `english`, `russian`, or `japanese`.
`category` accepts `movies`, `series`, or `anime`.
Mark adult content with `isNsfw: true` and publish it in the appropriate channel.
Use `directPlayback: true` for individual videos and `artworkLayout: "landscape"`
for wide thumbnails when appropriate. Return the actual `posterWidth` for small
thumbnails when known; do not guess it.

### 2.1. Remaining manifest fields and settings forms

The schema is strict: unknown fields are rejected. `schemaVersion`,
`sourceApiVersion`, and `minRuntimeAbi` are currently `1`. `minAppVersion` is the
minimum application SemVer; `version` is the package version. Keep package,
source, resolver, and publisher IDs unique and stable across ordinary updates.
`contributions.hostFeatures` lists known features only. The packer fills `files`
and the signature.

| Source field | Contract |
| --- | --- |
| `parameters` | Up to 32 string parameters, 2048 characters each; author configuration, not user secrets |
| `runtime.resolveTimeoutMs` | Resolver deadline, 30000–60000 ms; default 30000 |
| `presentation.icon` | Signed PNG inside `assets/`; the package icon is the separate top-level `icon` |
| `presentation.directPlayback` | Direct single-video viewing; default `false` |
| `presentation.artworkLayout` | `portrait` or `landscape` |
| `presentation.imageHeaders` | Up to five: User-Agent, Accept, Accept-Language, Referer, Origin; no control characters |
| `presentation.accessTokenHint` | Hint for the user access-token field |
| `network.allowSubdomains` | Additional subdomains of granted origins only when required; does not expand auth recipients |
| `network.injectAccessToken` | Host injects the user token for authorized destinations; the token is not a public parameter |
| `network.cookieDefaults` | Up to 32 public `{origin,path,name,value}` entries (language/consent); origin must be in `origins`; not account credentials |
| `network.settingsOrigins` | URL-setting ID → `http`, `httpAndAuth`, `image`, or `stream`; separate network grant |
| `web` | `{loginUrl,cookieOrigins}`; login and cookie origins must be in `authOrigins` |

Artwork headers support `{baseOrigin}` and `{imageOrigin}`, substituted by the
host for current mirrors. `authOrigins` must also be in `origins`. A base URL may
contain a path, but network grants contain origins only. Do not request
subdomains, authentication, or stream access “just in case”. Declare `auth`,
`accessToken`, `headers`, and `mirrors` only when the source uses those features.
`metadata` is mandatory.

Each `resolvers[]` entry has `id`, `sourceId`, `schemes`, and `origins`. Its
`sourceId` must refer to a source **in the same package**. `schemes` lists episode
URL schemes such as `examplecatalog`; `origins` lists exact HTTP(S) player-page
origins. A resolver declaration is not a network permission: also declare the
destinations in `network`. It cannot intercept another source's requests.

Network settings forms are separate from catalog filters. Supported kinds:
`select`, `url`, `text`; up to 16 fields and 32 options per selector.
`defaultValue` is required. `visibleWhen` must reference an **earlier** selector
and existing values. `defaultFromBaseUrl` selects the specified option when a
custom base address is configured. Text fields cannot declare `options`.

```javascript
const networkConfiguration = {
  network: {
    origins: ['https://example.org'], imageOrigins: ['https://images.example.org'],
    streamOrigins: ['https://video.example.org'], webOrigins: ['https://example.org'],
    authOrigins: [], methods: ['GET', 'POST'], maxConcurrentRequests: 4,
    allowUserBaseUrl: true, userBaseUrlUses: ['http'],
    settingsOrigins: {'example.api_mirror': 'http'},
  },
  networkSettings: [
    {id:'example.api_mode', label:'API', kind:'select', defaultValue:'official',
      defaultFromBaseUrl:'custom', options:[
        {value:'official',label:'Official'}, {value:'custom',label:'Custom'},
      ]},
    {id:'example.api_mirror', label:'API mirror URL', kind:'url', defaultValue:'',
      required:true, visibleWhen:{id:'example.api_mode',values:['custom']}},
  ],
};
```

Read `await context.settings.network()` in requests: use
`options['example.api_mirror']` only in `custom` mode; otherwise use the effective
`baseUrl`. A form declaration does not rewrite your request URLs. Labels should
be readable text; extensions cannot register arbitrary translation keys in the
application dictionary. The application owns form appearance and remote control
navigation; packages do not ship UI widgets.

## 3. Implementation example

The hypothetical API has `/api/titles`, `/api/titles/{id}`, and
`/api/episodes/{id}/stream`. Lists return `{items, hasMore}`, details return
`{item}`, and streams return `{variants, subtitleTracks}` in the SDK format.

```javascript
export default function createSource(context) {
  const prefix = 'example.catalog-';
  const fail = (code, message) => Object.assign(new Error(message), {code});

  async function request(path, params = {}) {
    const url = new URL(path, context.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, String(value));
    }
    const response = await context.http.request({
      method: 'GET', url: url.href, responseType: 'json',
    });
    if (response.status === 404) throw fail('not_found', 'Item not found');
    if (response.status >= 400) throw fail('network', 'Catalog request failed');
    return response;
  }

  function title(row, baseUrl) {
    return {
      id: prefix + row.id,
      title: row.title,
      kind: row.kind === 'series' ? 'series' : 'movie',
      webUrl: new URL(`/titles/${encodeURIComponent(row.id)}`, baseUrl).href,
      posterUrl: row.poster ? new URL(row.poster, baseUrl).href : '',
      overview: row.overview ?? '',
    };
  }

  async function listing({page = 1, searchTerm = '', selectedFilters = {}, sort = 'popular'} = {}) {
    const response = await request('/api/titles', {
      page, q: searchTerm, genre: selectedFilters.genre?.[0] ?? '', sort,
    });
    if (!Array.isArray(response.body.items)) throw fail('parse_error', 'Invalid catalog');
    return {
      items: response.body.items.map(row => title(row, response.url)),
      hasMore: response.body.hasMore === true,
    };
  }

  return {
    getPopular: listing,
    getLatest: args => listing({...args, sort: 'updated'}),
    search: listing,
    async getFilters() {
      return [{id: 'genre', title: 'Genre', kind: 'singleSelect', options: [
        {value: '', label: 'All'}, {value: 'comedy', label: 'Comedy'},
      ]}];
    },
    async loadDetails({itemId}) {
      if (!itemId.startsWith(prefix)) return null;
      const id = encodeURIComponent(itemId.slice(prefix.length));
      const response = await request(`/api/titles/${id}`);
      const row = response.body.item;
      if (!row) return null;
      return {...title(row, response.url), playbackGroups: [{
        id: 'original', title: 'Original audio',
        playerId: 'example-player', playerLabel: 'Example Player',
        episodes: (row.episodes ?? []).map(ep => ({
          id: `${prefix}${row.id}-episode-${ep.id}`,
          title: ep.title ?? `Episode ${ep.number}`,
          number: String(ep.number), season: String(ep.season ?? 1),
          url: `examplecatalog://episode/${encodeURIComponent(ep.id)}`,
        })),
      }]};
    },
    async loadPlaybackGroups() { return []; },
    async resolveStream({url}) {
      const uri = new URL(url);
      if (uri.protocol !== 'examplecatalog:' || uri.hostname !== 'episode') {
        throw fail('stream_unavailable', 'Unsupported episode');
      }
      const id = encodeURIComponent(decodeURIComponent(uri.pathname.slice(1)));
      const {body} = await request(`/api/episodes/${id}/stream`);
      if (!Array.isArray(body.variants) || !body.variants.length) {
        throw fail('stream_unavailable', 'No playable stream');
      }
      return {variants: body.variants, subtitleTracks: body.subtitleTracks ?? []};
    },
  };
}
```

This illustrates the contract; it is not a universal parser. A real source must
validate response shapes, URLs, quality labels, and MIME types before returning
data. The factory is synchronous. Importing the module or creating the source
must not make network requests, read settings, authenticate, or call the host.

## 4. HTML, filters, and results

Use projections to parse HTML without executing page scripts:

```javascript
const response = await context.http.request({
  method: 'GET', url: context.baseUrl, responseType: 'text',
});
const rows = await context.html.extract(response.body, {
  selector: '.tile', all: true,
  fields: {
    title: {selector: '.title', text: true, required: true},
    url: {selector: 'a', attr: 'href', absoluteUrl: true},
    poster: {selector: 'img', attr: 'src', absoluteUrl: true},
  },
}, response.url);
```

Resolve relative links against the final `response.url`. Use `html.extractMany`
for multiple documents and `html.text` for a batch of descriptions.

- Return JSON values only: no `undefined`, `NaN`, functions, cycles, or `Date` objects.
- A page is `{items, hasMore}`. Pagination, empty pages, and the last page must
  work with search and filters. Do not infer the last page from item count when
  the service supplies an explicit next-page indicator.
- Filter kinds: `toggle`, `text`, `singleSelect`, `multiSelect`,
  `triStateMultiSelect`, and `sort`. `value` is an API value; `label` is a readable
  user-facing name. Selected values arrive as arrays of strings.
- Metadata uses `kind`, `labelKey`, a readable `value`, and optional
  `filterId`/`filterValue`. Strip HTML from descriptions. Related titles must not
  recursively contain more related titles.
- The application assigns `sourceId` and `providerName`; omit them from results.
- `playerId` is a stable provider key; `playerLabel` is its display name. Set
  them on a group or episode. A token, URL, or episode number is not a provider ID.
- Return direct MP4/WebM/MKV, HLS, or DASH with the correct MIME type. An iframe
  page is not a stream. Return subtitles separately in `subtitleTracks`.
- Keep one `quality: "auto"` entry per HLS master. Deduplicate identical
  URL/quality/MIME variants. `isPreferred` identifies the preferred variant.
  Use `refreshBeforePlay` only for short-lived links and `requiresHlsProxy`
  only for providers that actually need that compatibility mode.

### 4.1. Every filter kind, from schema to request

`getFilters` describes a form; `search` applies its values. The form does not
filter a website by itself. Keep filter IDs and option values stable across
releases and map them to the actual server API. Labels can change without
changing IDs. A genre with ID `13` displays as “Adventure” but sends `13` in a
request. Do not put technical IDs in user-facing labels.

| Kind | Input in `selectedFilters[id]` | Purpose |
| --- | --- | --- |
| `toggle` | `['true']` when enabled; empty/`['false']` otherwise | Switch |
| `text` | `['2026']` | Text or number, validated by the source |
| `singleSelect` | `['tv']` or empty | One option |
| `multiSelect` | `['13', '7']` | Several included values |
| `triStateMultiSelect` | `['space', 'exclude:school']` | Include, exclude, ignore |
| `sort` | `['rating_desc']` | One option; author encodes direction |

Option fields: `value`, `label`, `description`, `count` (nonnegative integer or
`null`). Filter fields: `id`, `title`, `kind`, `description`, `placeholder`,
`defaultValues`, `options`, `isAvailableWithSearchTerm` (default `true`). Return
`false` when a filter cannot be combined with a search term. An empty option
`value: ''` can represent “Any”. `defaultValues` contains values, not indexes.
Represent ranges with separate minimum/maximum text filters; invented kinds
such as `slider` are unsupported.

All six kinds and an explicit translation to an **example** server API:

```javascript
export const filters = [
  {id: 'available', title: 'Available now', kind: 'toggle'},
  {id: 'year', title: 'Year', kind: 'text', placeholder: '2026'},
  {id: 'format', title: 'Format', kind: 'singleSelect', options: [
    {value: '', label: 'Any'}, {value: 'tv', label: 'TV'}, {value: 'movie', label: 'Movie'},
  ]},
  {id: 'genres', title: 'Genres', kind: 'multiSelect', options: [
    {value: '13', label: 'Adventure', count: 42}, {value: '7', label: 'Drama'},
  ]},
  {id: 'tags', title: 'Tags', kind: 'triStateMultiSelect', options: [
    {value: 'space', label: 'Space'}, {value: 'school', label: 'School'},
  ]},
  {id: 'sort', title: 'Sort', kind: 'sort', defaultValues: ['updated_desc'], options: [
    {value: 'updated_desc', label: 'Recently updated'},
    {value: 'rating_desc', label: 'Highest rated'},
    {value: 'rating_asc', label: 'Lowest rated'},
  ]},
];

export function catalogQuery({page = 1, searchTerm = '', selectedFilters = {}} = {}) {
  const values = (id) => Array.isArray(selectedFilters[id]) ? selectedFilters[id] : [];
  const first = (id) => values(id)[0] ?? '';
  const query = new URLSearchParams({page: String(Math.max(1, Math.trunc(page))),
    sort: first('sort') || 'updated_desc'});
  if (searchTerm.trim()) query.set('q', searchTerm.trim());
  if (values('available').includes('true')) query.set('available', '1');
  if (/^\d{4}$/.test(first('year'))) query.set('year', first('year'));
  if (first('format')) query.set('format', first('format'));
  if (values('genres').length) query.set('genres', values('genres').join(','));
  const included = [], excluded = [];
  for (const value of values('tags')) {
    if (value.startsWith('exclude:')) excluded.push(value.slice(8));
    else if (value.startsWith('!')) excluded.push(value.slice(1));
    else included.push(value);
  }
  if (included.length) query.set('tags', included.join(','));
  if (excluded.length) query.set('exclude_tags', excluded.join(','));
  return query;
}
```

Return `getFilters: () => filters` from the factory and use
`new URL('/api/catalog?' + catalogQuery(args), context.baseUrl)` in `search`.
Replace parameter names and list encoding with the website's actual rules;
the example does not assume every server supports `exclude_tags` or comma-separated lists.

For dynamic genres, `getFilters` may be `async`: fetch and validate a dictionary
and return the same structures. `refresh: true` must refresh it. Bound caches by
size/time and partition them by base URL, settings, and auth revision. Do not
reload dictionaries for every catalog page or episode. Handle removed options
explicitly; never turn arbitrary unknown filter IDs into request parameters.

### 4.2. Connecting metadata, episodes, and playback

- Clickable genre: `{kind:'genre', labelKey:'metadata.genre', value:'Adventure',
  filterId:'genres', filterValue:'13'}`. `filterValue` is the exact option value,
  while `value` is readable text. Saved positions use this mapping too.
- `Title.kind`: `movie`, `series`, `anime`. `rating` is a finite number; `year`
  is an integer or `null`. Artwork uses absolute URLs. Set `posterWidth` to the
  known physical width of a small thumbnail; do not invent a larger resolution.
- A movie also needs one playback group with one episode. Seasons and episodes
  have separate string `season`/`number` fields. Do not encode a voice into an
  episode ID: the same episode across players should retain identity and progress.
- Represent multiple players/voices as groups with stable IDs. `playerId` may
  be set on a group or episode and is inherited. The app uses it to remember a player.
- If episode enumeration is expensive, load it in `loadPlaybackGroups` using
  the current `itemId`/`url`. Do not resolve every episode stream when opening a title.
- `resolveStream` returns the selected episode only. Variant example:
  `{quality:'720', url:'https://cdn.example.org/episode.mp4', mimeType:'video/mp4',
  headers:{Referer:'https://example.org/'}}`. Use `application/vnd.apple.mpegurl`
  for HLS and `application/dash+xml` for DASH. A player HTML page is not a manifest.
- Subtitle example: `{id:'en', label:'English', language:'en', url:'https://cdn.example.org/en.vtt',
  mimeType:'text/vtt', headers:{Referer:'https://example.org/'}, isDefault:true}`.
  Supported text formats: VTT, SRT (`application/x-subrip`), ASS/SSA (`text/x-ssa`).
  Preserve actual headers and format; an error HTML page is not VTT.
- `isPreferred` identifies a preferred quality. `refreshBeforePlay` renews a
  short-lived link before first Play. Set `requiresHlsProxy` only for a verified
  compatibility need. These flags cannot repair an invalid URL.
- A metadata-only source declares `metadataOnly`, omits `streams`, and returns
  empty groups. `supportsTorrentSearch` enables release search when the
  corresponding application feature is installed and enabled.

### 4.3. Request flow

```mermaid
sequenceDiagram
  participant UI as Application
  participant JS as Extension
  participant H as Host API
  participant S as Website
  UI->>JS: getFilters / search / loadDetails
  JS->>H: http.request / html.extract
  H->>S: validated HTTP request
  S-->>H: data + final URL
  H-->>JS: JSON or text
  JS-->>UI: normalized result
  UI->>JS: resolveStream for selected episode
  JS-->>UI: variants + subtitles
  Note over UI,S: Player fetches video; JS does not relay video bytes
```

## 5. Networking, mirrors, and authentication

Use `context.http.request`, not global `fetch`. Declare HTTP/HTTPS origins
explicitly, including scheme and port, without paths or `*`:

| Field | Purpose |
| --- | --- |
| `origins` | API, HTML, and parser requests |
| `imageOrigins` | Posters and backdrops |
| `streamOrigins` | Video and subtitles |
| `webOrigins` | Public title links; does not grant API access |
| `authOrigins` | Exact session recipients; redirects do not expand them |
| `browserMediaOrigins` | Explicit browser MP4 delivery to the native player (Windows, Android phones/TV) |

Signed extensions may explicitly declare HTTP. Do not disable TLS validation.
The application follows redirects, including a new public domain, within the
current source and its active session. Changing the base resets these temporary
permissions. Cookies and `Authorization` are not forwarded to unrelated domains.

With `allowUserBaseUrl: true`, use `context.baseUrl` instead of hardcoding a
domain. `userBaseUrlUses` can additionally allow `image`, `stream`, or
`httpAndAuth` when the mirror serves those resources. Declare independent API
and image mirrors in `network.settingsOrigins`, and form fields in
`networkSettings`. See `sources/tmdb/manifest.json` for an example.

`networkSettings` supports `select`, `url`, `text`, stable `id`, `label`,
`defaultValue`, `required`, `options`, and `visibleWhen: {id, values}`. Conditions
refer to an earlier select. Read values with `context.settings.network()`.
A form does not grant network access by itself.

Permissions are `http`, `html`, `settings`, `sourceSession`, and `crypto`.
`settings.get/set` stores source-owned data; do not use it for secrets.
For login, declare the `auth` capability, `sourceSession` permission,
`web.loginUrl`, `web.cookieOrigins`, and exact `network.authOrigins`.
Browser and request profiles (`app`, `browser`, `mobileSafari`) must match.
Check `context.auth.status()`. Read an access token only explicitly through
`auth.getSession({includeAccessToken: true})` with the appropriate permission.
Scripts do not receive cookie headers. Do not put secrets in logs or returned data.

Session-bound single-file streams use the application's protected transport.
Session-bound HLS/DASH is not currently supported. Do not bypass this restriction
by exposing a token in a public URL.

A source may opt into `browserMediaOrigins` when its CDN challenges native HTTP
requests. Each origin must be exact HTTPS and explicitly present in `origins`,
`streamOrigins` and `authOrigins`; the package requires `sourceSession`.
On Windows (WebView2) and Android phones/TV (system WebView), the host reads
in chunks up to 1 MiB while preserving
native Range/HEAD semantics. Video still plays in the native player.
This grant is separate from `userAgentProfile: browser`, is never inferred from
redirects and does not enable other sources. Extension JavaScript receives no
browser APIs or cookies.

### 5.1. Complete public context

Exact signatures and DTO fields are in `sdk/index.d.ts`. This is a contract
reference, not an additional module to load from an installed package.

| API | Arguments / result |
| --- | --- |
| `sourceId`, `baseUrl`, `parameters` | Immutable ID, base address, and string manifest parameters |
| `http.request` | `method`: GET/POST/HEAD; `url`; `responseType`: text/json/bytes; optional `headers`, `body`, `timeoutMs`, `authRevision`, `userAgentProfile` |
| HTTP response | `{status, url, headers, body}`; final address in `url`; bytes is an array of integers 0–255 |
| `html.extract` | `(body, projection, baseUrl?)` → value/array; CSS projection, not a DOM |
| `html.extractMany` | `(bodies, projection, baseUrl?)` → results in input order |
| `html.text` | `(bodies)` → plain text array |
| `settings.network` | `()` → `{baseUrl, options}`; read-only user configuration |
| `settings.get/set` | `(key)` / `(key, JSON)`; source-owned nonsecret data |
| `auth.status` | `()` → `{authorized, revision}` |
| `auth.getSession` | `({includeAccessToken?})` → `{authorized, revision, accessToken?}` |
| `log.info` | `(event, fields?)`; short, nonsecret JSON diagnostics |
| `crypto.aesGcmEncrypt` | `{key, plaintext}` → base64 envelope nonce(12)+ciphertext+tag(16) |
| `crypto.aesGcmDecrypt` | `{key, envelope}` → UTF-8 text; base64 AES-256 key |
| `crypto.pbkdf2Sha256` | `{password, salt, iterations, length}` → base64 key; 1–200000 iterations, 1–64 output bytes |
| `crypto.aesCbcDecrypt` | base64 `{key, iv, ciphertext}` → UTF-8 text; PKCS7 |
| `crypto.chacha20DecryptCandidates` | base64 `{keys, nonce, ciphertext}` → `(string|null)[]`; IETF counter=0; at most 36 keys and 64 KiB ciphertext |
| `crypto.nonceSearch` | `[{prefix,targetHex}]` → nonce numbers; SHA256(prefix + decimal nonce) starts with targetHex; host-bounded work |

HTML projections support `selector`, `all`, `required`, `fields`, `text`, `attr`,
`html`, `outerHtml`, `tagName`, `absoluteUrl`, `textEquals`, `containsText`, `ascend`,
`nextSibling`, `directChildren`, `exclude`, and `normalizeWhitespace`. Use
`required` only for required elements: a missing optional poster should not fail
the whole catalog. Pass the final response address for `absoluteUrl` so relative
links resolve correctly after redirects.

For JSON POST, use an object in `body`. For an HTML form use
`new URLSearchParams(fields).toString()` with `Content-Type: application/x-www-form-urlencoded`.
Check `status` and body type first. A 401/403/429 is not an empty catalog; an HTML
challenge is not JSON. `timeoutMs` does not extend the total operation deadline.
Cookies, Host, and transport headers remain under host control.

The environment provides `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`,
and standard JavaScript operations. It does not provide `fetch`, `document`,
`window`, `localStorage`, filesystem access, sockets, or arbitrary native modules.
Bundle dependencies into one ES module; dynamically downloading executable code
is unsupported. The `crypto` permission grants the listed operations, not arbitrary code.

## 6. Performance, errors, and testing

Immutable tables can live at module scope; request-specific data belongs inside
methods. Do not mix pages, base URLs, or authorization revisions in a cache.
Coalesce identical in-flight work, bound cache size and lifetime, and remove
rejected promises. Fetch independent resources concurrently within
`maxConcurrentRequests` (1–8). Avoid unbounded `Promise.all` over every episode
or provider. Changing quality should not reload the catalog.

Ordinary calls have a 30-second limit. `sources[].runtime.resolveTimeoutMs` can
extend resolver time to 60 seconds. Do not leave work running after returning.
Pages are limited to 200 titles, filters to 64, and variants and subtitles to
128 each. HTTP bodies are limited to 4 MiB, or 1 MiB for binary responses.

Throw errors with a `code`, such as `network`, `not_found`, `auth_required`,
`challenge_required`, `parse_error`, or `stream_unavailable`. Cancellation,
permission denial, and resource exhaustion must not trigger provider fan-out
or infinite retries. Log events and non-secret fields, never cookies, tokens,
or signed stream URLs.

Place tests in `tests/*.test.mjs` using `node:test`, fixtures, and a mock context.
A minimal test for the example:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/my_catalog/src/index.mjs';

test('catalog uses the configured mirror', async () => {
  const urls = [];
  const source = createSource({
    baseUrl: 'https://mirror.example.org',
    http: {request: async ({url}) => {
      urls.push(url);
      return {status: 200, url, headers: {}, body: {
        items: [{id: 'one', title: 'Example', kind: 'movie'}], hasMore: false,
      }};
    }},
  });
  const page = await source.getPopular({page: 2});
  assert.equal(new URL(urls[0]).origin, 'https://mirror.example.org');
  assert.equal(new URL(urls[0]).searchParams.get('page'), '2');
  assert.equal(page.items[0].id, 'example.catalog-one');
  assert.equal(page.hasMore, false);
});
```

Before release, test first/second/last/empty pages, search, every filter, details,
recommendations, all players, audio choices, qualities, and subtitles. Include
malformed responses, 401/403/404/429/5xx, timeouts, cancellation, redirects, and
custom base URLs with relative images. Check desktop, phone, and TV interfaces.

## 7. Application feature packages

An existing feature needs no `entrypoint`, sources, resolvers, or execution
permissions. TorrServer example:

```json
{
  "schemaVersion": 1,
  "sourceApiVersion": 1,
  "minRuntimeAbi": 1,
  "id": "example.feature.torrserver",
  "name": "TorrServer",
  "description": "Enables TorrServer support",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "publisherKeyId": "example.publisher",
  "icon": "assets/icon.png",
  "permissions": [],
  "sources": [],
  "resolvers": [],
  "contributions": {"hostFeatures": ["torrents.torrserver"]},
  "files": {}
}
```

Add the feature ID to `repository.json.hostFeatures` and the publisher's grant
scope. The package enables existing screens and settings; inventing a feature
name does not implement it. A new feature type first needs support in the
application's public contract. See `examples/torrserver/` for the complete layout.

## 8. Packaging and publishing

Generate your own Ed25519 key outside the repository. Never use someone else's
key or put the private key in Git, packages, artifacts, or logs.

```sh
node tools/pack.mjs keygen --private /secure/example-publisher.pem
node tools/pack.mjs --project sources/my_catalog --key /secure/example-publisher.pem --key-id example.publisher --version 1.0.0 --output dist/my-catalog-1.0.0.fxextension
```

The packer bundles imports and resources, calculates hashes, signs the manifest,
and verifies the result. This does not publish anything. To prepare a full release:

```sh
node tools/release.mjs --key /secure/example-publisher.pem --key-id example.publisher --version 1.0.0 --output dist/release-1.0.0
```

The output directory must be new. Configure your own repository in
`repository.json`: name, channel (`standard`/`nsfw`), `publisherKeyId`,
`sourceIds`, and `hostFeatures`. The supplied key ID must match that configuration.

Publishing with the included `.github/workflows/release.yml`:

1. Create a GitHub repository, configure CI, and create the `extensions-release`
   environment. Restrict which tags and users can run a signed release.
2. Add environment secret `FILMORAX_SIGNING_KEY_BASE64`: base64 of the PKCS8 PEM
   file. Set variables `FILMORAX_PUBLISHER_KEY_ID` and
   `FILMORAX_PUBLISHER_FINGERPRINT`: SHA-256 of the raw 32-byte public key,
   as 64 lowercase hexadecimal characters. Preserve the fingerprint independently.
3. Run `npm test`, `npm run format:check`, and `npm run release:ci`.
   CI packages use a disposable key and are not production installation artifacts.
4. Create a SemVer tag, such as `v1.0.0`, on the reviewed commit and push it.
   A manual run requires an existing tag: its version without `v`, tag commit,
   and workflow commit must match. The release version is applied during packaging.
5. The GitHub Release must contain `.fxextension` packages, `release.json`,
   `release.ed25519`, `publisher.public.json`, `publisher.fingerprint.txt`, and
   accompanying `.sha256` files. Publish the complete set together.
6. Never replace an archive under an existing version or overwrite a release.
   Publish changed content under a new SemVer version with the same key.
   A different key or expanded permissions require a new trust decision.

Users open “Settings → Extensions → Load from GitHub” and enter
`owner/repository` or `https://github.com/owner/repository`. Release tag links are
also accepted. The application shows up to three latest compatible releases
and verifies signatures and hashes automatically; no manual SHA-256 entry or
local file selection is needed. Users select a release, review its contents and
permissions, confirm trust, and import packages. Updates require confirmation.
Removing a repository record does not uninstall its packages. Verify installation,
updates, and disabling on a separate test profile before publishing for everyone.

### 8.1. Documentation inside packages

In both repositories, `docs/` contains exactly two guides: this file and its
Russian counterpart. The packer automatically includes them in every archive as
`assets/docs/extensions.ru.md` and `assets/docs/extensions.en.md`, including the
TorrServer feature package. They are covered by signed `files`; changing them
requires repacking and signing. Do not copy the guides into each source manually.

### 8.2. Troubleshooting and API boundaries

| Symptom / question | Check / answer |
| --- | --- |
| Catalog fails | Check HTTP status, final URL, mirror, JSON shape/HTML selector, and `hasMore`; preserve a sanitized fixture |
| First page works, second does not | Use `page` for filtered searches too, ensure the URL changes, derive `hasMore` from actual pagination |
| Filter has no effect | Compare `selectedFilters` values with server parameters; the UI does not apply filtering itself |
| Genre IDs appear to users | Supply readable option `label` and metadata `value`; retain technical IDs in option `value` / metadata `filterValue` |
| No episodes | Check every season, API pagination, `loadPlaybackGroups`, and nonempty episode URLs; distinguish iframe pages from video |
| Player unavailable | Check direct URL/manifest, MIME, expiration, Referer, stream origins; do not return known broken variants to inflate the list |
| Missing subtitles | Check actual VTT/SRT/ASS text, MIME, headers, and URL access; set `isDefault:true` on a default track |
| Mirror change retains old data | Remove hardcoded domains, partition/invalidate caches by settings, and resolve against final response URLs |
| `permission_denied` | Check permission, exact origin, allowed HTTP methods, source/resolver scope, and active authentication |
| `invalid_response` / `parse_error` | Check strict DTO fields, duplicate IDs, finite numbers, limits, body type, and required elements |
| `auth_session_changed` / `cancelled` | Stop the operation; do not fan out to more providers |
| Can a package add a new native feature? | It can enable only known `hostFeature` IDs; a new ID needs implementation and application support |
| Can arbitrary code change the UI? | No. Packages return data, filters, settings, and feature declarations; screens belong to the application |
| Can a GitHub key be trusted automatically? | No. Signatures establish integrity/identity; users decide whether to trust the publisher |
| Can an update reuse an old version? | No. Publish a new SemVer and immutable release; never replace existing artifacts |

Check Windows, Android, and TV: form labels should be concise and must not
depend on a pointer. Switching source/profile/auth during a request must not
return an earlier session's data. Keep live network tests separate from
deterministic fixtures. Do not store other people's cookies, tokens, videos,
or unsanitized responses. Preserve code and icon licenses and provenance.
