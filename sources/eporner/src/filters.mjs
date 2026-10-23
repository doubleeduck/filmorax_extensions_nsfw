import { text, array } from '../../../sdk/video.mjs';
import categories from './categories.mjs';
const sortOptions = [
  ['latest', 'new'],
  ['top-weekly', 'popular_week'],
  ['top-monthly', 'popular_month'],
  ['most-popular', 'popular'],
  ['top-rated', 'rating'],
  ['longest', 'longest'],
  ['shortest', 'shortest'],
];
export const filters = [
  {
    id: 'sort',
    title: 'source_filter.sort',
    kind: 'sort',
    defaultValues: ['latest'],
    options: sortOptions.map(([value, key]) => ({ value, label: `source_filter.sort.${key}` })),
  },
  {
    id: 'production',
    title: 'source_filter.production',
    description: 'source_filter.production_catalog_only',
    kind: 'singleSelect',
    defaultValues: ['all'],
    isAvailableWithSearchTerm: false,
    options: ['all', 'professional', 'homemade'].map((value) => ({
      value,
      label: `source_filter.production.${value}`,
    })),
  },
  {
    id: 'quality',
    title: 'source_filter.quality',
    kind: 'singleSelect',
    defaultValues: ['all'],
    options: [
      { value: 'all', label: 'filters.any' },
      { value: '720', label: '720p+' },
      { value: '1080', label: '1080p+' },
      { value: '2160', label: '4K' },
    ],
  },
  ...['min', 'max'].map((key) => ({
    id: `duration_${key}`,
    title: 'source_filter.duration_minutes',
    description: 'source_filter.duration_minutes_description',
    placeholder: `source_filter.duration_${key}_placeholder`,
    kind: 'text',
  })),
  {
    id: 'categories',
    title: 'source_filter.categories',
    description: 'source_filter.eporner_categories_description',
    kind: 'triStateMultiSelect',
    options: categories,
  },
];
export function catalogRequest({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
  page = Math.max(1, page);
  const f = selectedFilters,
    term = text(searchTerm),
    sort = sortOptions.some((v) => v[0] === f.sort?.[0]) ? f.sort[0] : 'latest',
    production = ['professional', 'homemade'].includes(f.production?.[0]) ? f.production[0] : 'all',
    quality = ['720', '1080', '2160'].includes(f.quality?.[0]) ? f.quality[0] : 'all';
  const known = new Set(categories.map((v) => v.value)),
    included = new Set(),
    excluded = new Set();
  for (const raw of array(f.categories)) {
    const value = text(raw),
      exclude = value.startsWith('!') || value.startsWith('exclude:'),
      key = value.replace(/^(?:!|include:|exclude:)/, '');
    if (known.has(key)) (exclude ? excluded : included).add(key);
  }
  const include = categories
      .map((v) => v.value)
      .filter((v) => included.has(v) && !excluded.has(v))
      .slice(0, 5),
    exclude = categories
      .map((v) => v.value)
      .filter((v) => excluded.has(v))
      .slice(0, 10);
  function minutes(value, max) {
    value = text(value);
    if (!/^\d+$/.test(value) || Number(value) <= 0 || (max && Number(value) > 60)) return null;
    return Math.min(60, Number(value)) * 60;
  }
  let min = minutes(f.duration_min?.[0], false),
    max = minutes(f.duration_max?.[0], true);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const siteSort = sort === 'most-popular' ? 'most-viewed' : sort,
    segments = term
      ? [
          'tag',
          encodeURIComponent(term.replace(/\s+/g, '-')),
          ...(page > 1 ? [String(page)] : []),
          ...(sort !== 'latest' ? [siteSort] : []),
        ]
      : [
          'cat',
          ...(include.length ? include : ['all']),
          ...(production === 'professional'
            ? ['PROD-pro']
            : production === 'homemade'
              ? ['PROD-home']
              : []),
          ...(sort !== 'latest' ? ['SORT-' + siteSort] : []),
          ...(page > 1 ? [String(page)] : []),
        ];
  return {
    path: '/' + segments.join('/') + '/',
    query: {
      ...(quality !== 'all' ? { quality } : {}),
      ...(min != null ? { duration_min: String(min) } : {}),
      ...(max != null ? { duration_max: String(max) } : {}),
      ...(term && include.length ? { include: include.join(',') } : {}),
      ...(exclude.length ? { exclude: exclude.join(',') } : {}),
    },
  };
}
