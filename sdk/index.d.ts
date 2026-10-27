/** FilmoraX source API v1. No browser DOM, Node or platform APIs. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface SourceContext {
  readonly sourceId: string;
  readonly baseUrl: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly http: {
    request(input: {
      method: 'GET' | 'POST' | 'HEAD';
      url: string;
      responseType: 'text' | 'json' | 'bytes';
      headers?: Record<string, string>;
      body?: Json;
      timeoutMs?: number;
      authRevision?: number;
      userAgentProfile?: 'app' | 'browser' | 'mobileSafari';
    }): Promise<{
      status: number;
      url: string;
      headers: Record<string, string>;
      body: Json;
    }>;
  };
  readonly html: {
    extract(body: string, query: HtmlProjection, baseUrl?: string): Promise<Json>;
    extractMany(bodies: string[], query: HtmlProjection, baseUrl?: string): Promise<Json[]>;
    /** Batch HTML-to-text: one trusted parser isolate, no wrapper HTML tricks. */
    text(bodies: string[]): Promise<string[]>;
  };
  readonly settings: {
    get(key: string): Promise<Json>;
    set(key: string, value: Json): Promise<null>;
    /** User-owned app preferences; scripts cannot write them. */
    network(): Promise<{ baseUrl: string; options: Record<string, string> }>;
  };
  readonly auth: {
    status(): Promise<{ authorized: boolean; revision: number }>;
    getSession(input?: { includeAccessToken?: boolean }): Promise<{
      authorized: boolean;
      revision: number;
      accessToken?: string | null;
    }>;
  };
  readonly log: { info(event: string, fields?: Record<string, Json>): void };
  readonly crypto: {
    /** AES-256-GCM envelope: base64(nonce[12] + ciphertext + tag[16]). */
    aesGcmEncrypt(input: { key: string; plaintext: string }): Promise<string>;
    aesGcmDecrypt(input: { key: string; envelope: string }): Promise<string>;
    /** SHA256(prefix + decimal nonce) starts with targetHex; bounded host work. */
    nonceSearch(jobs: { prefix: string; targetHex: string }[]): Promise<number[]>;
    /** PBKDF2-HMAC-SHA256, 1..200000 iterations, 1..64 output bytes in base64. */
    pbkdf2Sha256(input: {
      password: string;
      salt: string;
      iterations: number;
      length: number;
    }): Promise<string>;
    /** AES CBC with PKCS7; base64 key/IV/ciphertext, strict UTF-8 plaintext. */
    aesCbcDecrypt(input: { key: string; iv: string; ciphertext: string }): Promise<string>;
    /** IETF ChaCha20 counter=0, max 36 keys / 64KiB ciphertext. Invalid UTF-8 -> null. */
    chacha20DecryptCandidates(input: {
      keys: string[];
      nonce: string;
      ciphertext: string;
    }): Promise<(string | null)[]>;
  };
}
export interface HtmlProjection {
  selector?: string;
  all?: boolean;
  required?: boolean;
  fields?: Record<string, HtmlProjection>;
  text?: boolean;
  attr?: string;
  html?: boolean;
  outerHtml?: boolean;
  tagName?: boolean;
  absoluteUrl?: boolean;
  textEquals?: string;
  containsText?: string[];
  ascend?: number;
  nextSibling?: boolean;
  directChildren?: boolean;
  exclude?: string;
  normalizeWhitespace?: boolean;
}
export interface Query {
  page?: number;
  searchTerm?: string;
  selectedFilters?: Record<string, string[]>;
}
export interface Page {
  items: Title[];
  hasMore: boolean;
}
export interface Title {
  id: string;
  title: string;
  kind: 'movie' | 'series' | 'anime';
  originalTitle?: string;
  /** Public title page. Source identity is assigned by the host, not this DTO. */
  webUrl?: string;
  subtitle?: string;
  overview?: string;
  rating?: number;
  year?: number | null;
  posterUrl?: string;
  /** Actual native thumbnail width, when known; avoids decode upscaling. */
  posterWidth?: number | null;
  backdropUrl?: string;
  isNsfw?: boolean;
  tags?: string[];
  metadata?: Metadata[];
  playbackGroups?: PlaybackGroup[];
  relatedItems?: Title[];
}
export interface Metadata {
  kind:
    | 'type'
    | 'studio'
    | 'director'
    | 'author'
    | 'publisher'
    | 'episodes'
    | 'status'
    | 'year'
    | 'country'
    | 'quality'
    | 'translation'
    | 'genre'
    | 'tag';
  labelKey: string;
  value: string;
  filterId?: string;
  filterValue?: string;
}
export interface Episode {
  id: string;
  title: string;
  number?: string;
  season?: string;
  subtitle?: string;
  /** HTTPS resolver page or opaque scheme declared by this package, not a WebView. */
  url: string;
  /** Stable provider preference key, not an episode ID or URL. */
  playerId?: string;
  playerLabel?: string;
  durationSeconds?: number | null;
}
export interface PlaybackGroup {
  id: string;
  title: string;
  subtitle?: string;
  /** Defaults inherited by each episode; an episode may override them. */
  playerId?: string;
  playerLabel?: string;
  episodes: Episode[];
}
export interface Filter {
  id: string;
  title: string;
  kind: 'toggle' | 'text' | 'singleSelect' | 'multiSelect' | 'triStateMultiSelect' | 'sort';
  description?: string;
  placeholder?: string;
  defaultValues?: string[];
  isAvailableWithSearchTerm?: boolean;
  options?: { value: string; label: string; description?: string; count?: number | null }[];
}
export interface Stream {
  variants: {
    quality: string;
    /** Renew a short-lived signed URL before the user's first Play action. */
    refreshBeforePlay?: boolean;
    /** Opt in to the host's range-free HLS segment compatibility transport. */
    requiresHlsProxy?: boolean;
    url: string;
    mimeType:
      | 'video/mp4'
      | 'video/webm'
      | 'video/x-matroska'
      | 'application/vnd.apple.mpegurl'
      | 'application/x-mpegURL'
      | 'application/dash+xml';
    headers?: Record<string, string>;
    isPreferred?: boolean;
  }[];
  subtitleTracks?: {
    id: string;
    label?: string;
    language?: string;
    url: string;
    mimeType?: string;
    headers?: Record<string, string>;
    isDefault?: boolean;
  }[];
}
export interface Source {
  loadDetails(input: { itemId: string }): Promise<Title | null>;
  getFilters?(input: { refresh?: boolean }): Filter[] | Promise<Filter[]>;
  getPopular?(input: { page?: number }): Promise<Page>;
  getLatest?(input: { page?: number }): Promise<Page>;
  search?(input: Query): Promise<Page>;
  loadPlaybackGroups?(input: { itemId?: string; url?: string }): Promise<PlaybackGroup[]>;
  resolveStream?(input: { url: string }): Promise<Stream>;
  getRecommendations?(input: { itemId: string }): Promise<Title[]>;
}
export type SourceFactory = (context: SourceContext) => Source;
