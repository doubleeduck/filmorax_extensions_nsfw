/**
 * Complete API example with deterministic offline data. All URLs use reserved
 * example.org domains: installing this demo does not provide playable media.
 * No host calls are made while importing the module or creating the factory.
 */
export default function createSource(context) {
  const summary = () => ({
    id: 'example.demo-one',
    title: 'Demo film',
    kind: 'movie',
    webUrl: new URL('/titles/one', context.baseUrl).href,
    overview: 'A local SDK fixture. Replace this data with your own HTTP/HTML parser.',
    year: 2026,
    rating: 0,
    tags: ['Demo'],
  });
  const groups = () => [
    {
      id: 'demo-native',
      title: 'Original audio',
      playerId: 'demo-native',
      playerLabel: 'Demo HLS',
      episodes: [{ id: 'demo-one', title: 'Demo film', number: '1', url: 'demo://episode/one' }],
    },
  ];
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const term = searchTerm.trim().toLowerCase();
    const genre = selectedFilters.genre?.[0] ?? 'all';
    return {
      items:
        page === 1 && (!term || 'demo film'.includes(term)) && ['all', 'demo'].includes(genre)
          ? [summary()]
          : [],
      hasMore: false,
    };
  }
  return {
    getPopular: search,
    getLatest: search,
    search,
    async getFilters() {
      return [
        {
          id: 'genre',
          title: 'Genre',
          kind: 'singleSelect',
          defaultValues: ['all'],
          options: [
            { value: 'all', label: 'All' },
            { value: 'demo', label: 'Demo' },
          ],
        },
      ];
    },
    async loadDetails({ itemId }) {
      return itemId === 'example.demo-one'
        ? { ...summary(), playbackGroups: groups(), relatedItems: [] }
        : null;
    },
    async loadPlaybackGroups() {
      return [];
    },
    async resolveStream({ url }) {
      if (url !== 'demo://episode/one') {
        throw Object.assign(new Error('Unknown demo episode'), { code: 'stream_unavailable' });
      }
      return {
        variants: [
          {
            quality: 'auto',
            url: 'https://video.example.org/demo/master.m3u8',
            mimeType: 'application/vnd.apple.mpegurl',
          },
        ],
      };
    },
  };
}
