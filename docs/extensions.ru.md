# Расширения FilmoraX: руководство разработчика

[English](extensions.en.md)

Расширение — подписанный пакет `.fxextension`. Оно может поставлять один или
несколько источников каталога либо включать уже поддержанную функцию приложения.
Источник содержит ES-модуль JavaScript, манифест, лицензию и локальные изображения.
Пакет функции содержит декларацию возможностей. Произвольные интерфейсы и
исполняемые файлы операционной системы через расширения не устанавливаются.

## 1. Репозиторий и инструменты

Нужен Node.js 22 или новее. Работайте в репозитории расширений:

- `fx_extensions` — обычные источники и пакет TorrServer;
- `nsfw_fx_extensions` — источники для взрослых.

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm test
npm run format:check
```

Типы публичного API находятся в `sdk/index.d.ts`, готовый автономный пример —
в `examples/demo/`. Общие функции расположены в `sdk/`, движки сайтов —
в `engines/`, парсеры видеопровайдеров — в `resolvers/`. Повторно используйте их
вместо копирования одной реализации в несколько источников. Импорты собираются
в пакет: зависимости из соседнего репозитория во время работы недоступны.

Структура нового источника:

```text
sources/my_catalog/
  manifest.json
  LICENSE
  assets/icon.png
  src/index.mjs
tests/my_catalog.test.mjs
```

Используйте собственные стабильные ID пакета, источника, групп и серий. Они не
должны зависеть от зеркала, токена или времени запроса. Добавьте ID источника
в `repository.json.sourceIds`. В новом репозитории перечислите только реально
публикуемые источники и функции; задайте собственный `publisherKeyId`.

## 2. Манифест источника

Ниже пример для условного JSON API. Адреса `example.org` — примеры, а не сервис
с готовым каталогом. Замените их адресами своего сайта и добавьте `LICENSE` и PNG.

```json
{
  "schemaVersion": 1,
  "sourceApiVersion": 1,
  "minRuntimeAbi": 1,
  "id": "example.source.catalog",
  "name": "My Catalog",
  "description": "Каталог, фильтры, серии и видеопотоки",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "publisherKeyId": "example.publisher",
  "icon": "assets/icon.png",
  "entrypoint": "src/index.mjs",
  "permissions": ["http", "html"],
  "sources": [{
    "id": "example.catalog",
    "name": "My Catalog",
    "description": "Фильмы и сериалы",
    "language": "russian",
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

`files`, размеры, хэши и подпись заполняет упаковщик. Не редактируйте готовый
подписанный архив. Иконка — локальный статичный PNG, до 256 КиБ и 512×512,
включённый в подпись. Укажите происхождение изображения и соблюдайте его лицензию.

Объявляйте только реализованные возможности:

| Возможность | Методы и поведение |
| --- | --- |
| Любой источник | `loadDetails({itemId})` обязателен; неизвестный ID возвращает `null` |
| `catalog` | `getPopular({page})` и `getLatest({page})` |
| `search` | `search({page, searchTerm, selectedFilters})` |
| `filters` | `getFilters({refresh})` |
| `playbackGroups` | `loadPlaybackGroups({itemId, url})`; `[]`, если группы уже есть в деталях |
| `streams` | `resolveStream({url})` и соответствующая запись `resolvers` |
| `recommendations` | `getRecommendations({itemId})` |
| `metadataOnly` | Источник метаданных без `streams` |

`language`: `international`, `english`, `russian` или `japanese`;
`category`: `movies`, `series` или `anime`.
Контент для взрослых помечайте `isNsfw: true` и публикуйте в соответствующем
канале. Для одиночных видео допустим `directPlayback: true`; для широких
миниатюр — `artworkLayout: "landscape"`. Известную ширину маленькой обложки
передавайте в `posterWidth` результата, не выдумывайте её.

### 2.1. Остальные поля манифеста и формы настроек

Схема строгая: неизвестные поля отвергаются. Версии `schemaVersion`,
`sourceApiVersion`, `minRuntimeAbi` сейчас равны `1`; `minAppVersion` — минимальный
SemVer приложения, а `version` — версия пакета. ID пакета, источников, резолверов
и издателя должны быть уникальными устойчивыми строками; не меняйте их при
обычном обновлении. `contributions.hostFeatures` перечисляет только известные
функции. `files` и подпись заполняет упаковщик.

| Поле источника | Контракт |
| --- | --- |
| `parameters` | До 32 строковых параметров, до 2048 символов каждый; настройки автора, не секреты пользователя |
| `runtime.resolveTimeoutMs` | Дедлайн резолвера 30000–60000 мс; без поля — 30000 |
| `presentation.icon` | Подписанный PNG внутри `assets/`; иконка пакета отдельно задаётся верхним `icon` |
| `presentation.directPlayback` | Прямой просмотр отдельного видео; по умолчанию `false` |
| `presentation.artworkLayout` | `portrait` либо `landscape` |
| `presentation.imageHeaders` | До пяти: User-Agent, Accept, Accept-Language, Referer, Origin; без управляющих символов |
| `presentation.accessTokenHint` | Подсказка поля пользовательского токена |
| `network.allowSubdomains` | Дополнительные поддомены разрешённых origin только при явной необходимости; не расширяет получателей авторизации |
| `network.injectAccessToken` | Инъекция пользовательского токена хостом для разрешённых адресов; токен не становится публичным параметром |
| `network.cookieDefaults` | До 32 публичных `{origin,path,name,value}` (язык/consent); origin должен быть в `origins`; не используйте для аккаунтов |
| `network.settingsOrigins` | ID URL-настройки → `http`, `httpAndAuth`, `image` или `stream`; это отдельный сетевой grant |
| `web` | `{loginUrl,cookieOrigins}`; адрес входа и cookie origins должны быть в `authOrigins` |

В заголовках картинок поддерживаются `{baseOrigin}` и `{imageOrigin}`; они
подставляются хостом для текущих зеркал. `authOrigins` должны входить в `origins`.
Base URL может содержать путь, но сетевые grants указывают только origin.
Не запрашивайте `allowSubdomains`, авторизацию или доступ к потоку «на всякий случай».
Возможности `auth`, `accessToken`, `headers`, `mirrors` объявляйте, когда источник
действительно использует соответствующую функцию. `metadata` обязательно.

`resolvers[]` содержит `id`, `sourceId`, `schemes`, `origins`. `sourceId` должен
принадлежать источнику **этого же пакета**. `schemes` — схемы URL ваших эпизодов,
например `examplecatalog`; `origins` — точные HTTP(S) origin страниц плееров.
Декларация не является сетевым разрешением: нужные адреса также объявляются в
`network`. Она не даёт права перехватывать запросы чужого источника.

Формы сетевых настроек не являются фильтрами каталога. Для формы поддерживаются
`select`, `url`, `text` (до 16 полей, до 32 опций в селекторе). `defaultValue`
обязателен. `visibleWhen` ссылается на **ранее объявленный** селектор и его
существующие значения. `defaultFromBaseUrl` выбирает указанную опцию, когда
настроен собственный базовый адрес. Текстовое поле не может иметь `options`.

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

В запросе читайте `await context.settings.network()`: выбирайте значение
`options['example.api_mirror']` только при режиме `custom`, иначе используйте
актуальный `baseUrl`. Само объявление формы не меняет URL ваших запросов.
Метки должны быть читаемым текстом; произвольные ключи перевода расширение
в словарь приложения не добавляет. Внешний вид формы и управление пультом
обеспечивает приложение, свои виджеты пакет не поставляет.

## 3. Пример реализации

Предполагается API с `/api/titles`, `/api/titles/{id}` и
`/api/episodes/{id}/stream`. Список возвращает `{items, hasMore}`, детали —
`{item}`, поток — `{variants, subtitleTracks}` в формате SDK.

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

Это пример контракта, не универсальный парсер. В реальном источнике проверяйте
схему ответа, URL, качество и MIME перед формированием результата. Фабрика
должна быть синхронной; импорт и создание объекта не выполняют сетевых запросов,
чтения настроек, входа или другой работы с окружением.

## 4. HTML, фильтры и результаты

HTML разбирается проекциями, без выполнения скриптов страницы:

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

Используйте конечный `response.url` как базу относительных ссылок. Для нескольких
документов используйте `html.extractMany`, для списка описаний — `html.text`.

- Возвращайте только JSON: без `undefined`, `NaN`, функций, циклов и объектов `Date`.
- Страница — `{items, hasMore}`. Пагинация, пустая страница и последняя страница
  должны работать и с поиском, и с фильтрами. Не определяйте конец по длине,
  если сайт предоставляет явный признак следующей страницы.
- Фильтры: `toggle`, `text`, `singleSelect`, `multiSelect`,
  `triStateMultiSelect`, `sort`. `value` — значение для API, `label` — читаемое
  имя для пользователя. Выбранные значения приходят массивами строк.
- Метаданные используют `kind`, `labelKey`, читаемое `value` и, если нужно,
  `filterId`/`filterValue`. Описание очищайте от HTML. Рекомендации не вкладывают
  в себя дополнительные рекомендации.
- `sourceId` и `providerName` назначает приложение; не подставляйте их в результат.
- `playerId` — постоянный ключ видеопровайдера; `playerLabel` — его название.
  Их можно задавать на группе или серии. Токен, URL и номер серии не подходят
  в качестве `playerId`.
- Возвращайте прямые MP4/WebM/MKV, HLS или DASH с правильным MIME. Страница iframe
  не является потоком. Субтитры идут отдельным `subtitleTracks`.
- У одного HLS master оставляйте одну запись `quality: "auto"`; не дублируйте
  одинаковые URL/качество/MIME. `isPreferred` задаёт предпочтительный вариант.
  `refreshBeforePlay` нужен только короткоживущим ссылкам;
  `requiresHlsProxy` — только провайдерам, которым нужна эта совместимость.

### 4.1. Все виды фильтров: от схемы до запроса

`getFilters` описывает форму; `search` применяет её значения. Сама форма не
фильтрует сайт. Идентификаторы фильтров и значения опций должны совпадать с
параметрами вашего API и оставаться стабильными между релизами. Надписи можно
менять без изменения ID. Например, жанр с ID `13` показывается как «Приключения»,
а в запрос отправляется `13`. Не возвращайте пользователю технические ID в `label`.

| Вид | Вход в `selectedFilters[id]` | Назначение |
| --- | --- | --- |
| `toggle` | `['true']` при включении; пусто/`['false']` при выключении | Переключатель |
| `text` | `['2026']` | Текст или число; проверку выполняет источник |
| `singleSelect` | `['tv']` либо пусто | Одна опция |
| `multiSelect` | `['13', '7']` | Несколько включённых значений |
| `triStateMultiSelect` | `['space', 'exclude:school']` | Включить, исключить, игнорировать |
| `sort` | `['rating_desc']` | Одна опция сортировки, направление кодирует автор |

У опции доступны `value`, `label`, `description`, `count` (неотрицательное целое
или `null`). У фильтра — `id`, `title`, `kind`, `description`, `placeholder`,
`defaultValues`, `options`, `isAvailableWithSearchTerm` (по умолчанию `true`).
Если сайт не позволяет совмещать фильтр с поиском, верните `false`.
Пустая опция `value: ''` подходит для «Любой». `defaultValues` — массив значений,
не индексов. Диапазон задавайте двумя текстовыми фильтрами минимума и максимума;
новые `kind` вроде `slider` контракт не поддерживает.

Пример всех шести видов и явного перевода в параметры **примерного** сервера:

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

В фабрике возвращайте `getFilters: () => filters`, а в `search` используйте
`new URL('/api/catalog?' + catalogQuery(args), context.baseUrl)`. Замените названия
параметров и способ объединения значений на реальные правила сайта. Этот пример
не предполагает, что любой сервер поддерживает `exclude_tags` или списки через запятую.

Для динамических жанров `getFilters` может быть `async`: получите справочник,
проверьте ответ, верните те же структуры. `refresh: true` должен обновлять
справочник. Кэш ограничивайте по размеру/времени и разделяйте по базовому URL,
настройкам и ревизии авторизации. Фильтры не загружайте заново на каждую страницу
каталога или для каждого эпизода. Удалённые сервером опции обрабатывайте явно,
а неизвестные ID не превращайте в произвольные параметры запроса.

### 4.2. Связь метаданных, эпизодов и просмотра

- Кликабельный жанр: `{kind:'genre', labelKey:'metadata.genre', value:'Adventure',
  filterId:'genres', filterValue:'13'}`. `filterValue` — точное `options[].value`,
  `value` — читаемый текст. Для сохранённых позиций сохраняется именно эта связь.
- `Title.kind`: `movie`, `series`, `anime`. `rating` — конечное число;
  `year` — целое или `null`. Обложки — абсолютные URL. Известную физическую ширину
  маленькой миниатюры передавайте в `posterWidth`; не придумывайте большую ширину.
- Для одного фильма тоже нужен `playbackGroups` с одним эпизодом. У сезона/серии
  есть отдельные строковые `season`/`number`. Не зашивайте озвучку в ID серии:
  один эпизод на разных плеерах должен сохранять свою идентичность и прогресс.
- Несколько плееров/озвучек оформляйте группами с устойчивыми ID. `playerId`
  задаётся группе или эпизоду и наследуется; по нему приложение запоминает плеер.
- Если список эпизодов дорогой, загрузите его в `loadPlaybackGroups` по текущему
  `itemId`/`url`. Не скачивайте потоки всех серий при открытии карточки тайтла.
- `resolveStream` возвращает только текущий эпизод. Вариант: `{quality:'720',
  url:'https://cdn.example.org/episode.mp4', mimeType:'video/mp4', headers:{Referer:'https://example.org/'}}`.
  Для HLS используйте `application/vnd.apple.mpegurl`, для DASH —
  `application/dash+xml`; URL HTML-страницы вместо манифеста недопустим.
- Субтитр: `{id:'en', label:'English', language:'en', url:'https://cdn.example.org/en.vtt',
  mimeType:'text/vtt', headers:{Referer:'https://example.org/'}, isDefault:true}`.
  Поддерживаются VTT, SRT (`application/x-subrip`), ASS/SSA (`text/x-ssa`).
  Укажите реальные заголовки и формат. Не выдавайте за VTT страницу ошибки.
- `isPreferred` выделяет вариант качества. `refreshBeforePlay` обновляет
  короткоживущую ссылку перед первым Play. `requiresHlsProxy` включайте только
  для подтверждённой необходимости. Эти флаги не исправляют невалидный URL.
- Metadata-only источник объявляет `metadataOnly`, не объявляет `streams`,
  возвращает пустые группы. `supportsTorrentSearch` позволяет искать релизы,
  когда установлена и включена соответствующая функция приложения.

### 4.3. Путь запроса

```mermaid
sequenceDiagram
  participant UI as Приложение
  participant JS as Расширение
  participant H as Host API
  participant S as Сайт
  UI->>JS: getFilters / search / loadDetails
  JS->>H: http.request / html.extract
  H->>S: проверенный HTTP-запрос
  S-->>H: данные + конечный URL
  H-->>JS: JSON или текст
  JS-->>UI: нормализованный результат
  UI->>JS: resolveStream выбранной серии
  JS-->>UI: варианты + субтитры
  Note over UI,S: Видео получает плеер; JS не пересылает видео побайтно
```

## 5. Сеть, зеркала и авторизация

Все запросы выполняются через `context.http.request`, а не через глобальный
`fetch`. Объявите HTTP/HTTPS origins явно, со схемой и портом, без путей и `*`:

| Поле | Для чего |
| --- | --- |
| `origins` | API, HTML и запросы парсера |
| `imageOrigins` | Обложки и фоновые изображения |
| `streamOrigins` | Видео и субтитры |
| `webOrigins` | Публичные ссылки карточек; не выдаёт разрешений на API |
| `authOrigins` | Точные адресаты сессии; не расширяются редиректом |
| `browserMediaOrigins` | Явное включение браузерной загрузки MP4 для нативного плеера (Windows) |

Подписанное расширение может объявить HTTP. Не отключайте проверку TLS.
Приложение следует редиректам, включая новый публичный домен, в пределах текущего
источника и его активной сессии. После смены базы эти временные разрешения
сбрасываются. Cookies и `Authorization` не пересылаются чужому домену.

При `allowUserBaseUrl: true` используйте `context.baseUrl`, не зашивайте домен
в парсер. `userBaseUrlUses` дополнительно разрешает `image`, `stream` или
`httpAndAuth`, если зеркало обслуживает эти ресурсы. Отдельные API/image-зеркала
объявляются в `network.settingsOrigins`; поля формы — в `networkSettings`.
Пример есть в `sources/tmdb/manifest.json`.

`networkSettings` поддерживает `select`, `url`, `text`, стабильные `id`, `label`,
`defaultValue`, `required`, `options` и `visibleWhen: {id, values}`. Условие
ссылается на предшествующий select. Значения читаются через
`context.settings.network()`. Форма сама не выдаёт сетевых разрешений.

Разрешения: `http`, `html`, `settings`, `sourceSession`, `crypto`.
`settings.get/set` хранит собственные данные источника; секреты туда не помещают.
Для входа объявите `auth` в capabilities, `sourceSession` в permissions,
`web.loginUrl`, `web.cookieOrigins` и точные `network.authOrigins`.
Профиль браузера и запросов (`app`, `browser`, `mobileSafari`) должен совпадать.
Проверяйте `context.auth.status()`. Чтение токена возможно только явно через
`auth.getSession({includeAccessToken: true})` при соответствующем разрешении.
Cookie-заголовки скрипту не выдаются. Не отправляйте секреты в логи или DTO.

Потоки с сессией для одиночных медиафайлов обслуживает защищённый транспорт
приложения. Потоки HLS/DASH, требующие такой сессии, пока не поддерживаются.
Не обходите это ограничение переносом токена в публичный URL.

Если CDN отклоняет нативный HTTP-клиент проверкой Cloudflare, источник может
объявить `browserMediaOrigins`. Каждый адрес должен быть точным HTTPS origin
и одновременно присутствовать в `origins`, `streamOrigins` и `authOrigins`;
пакету требуется `sourceSession`. Хост Windows загрузит файл через WebView2
порциями до 1 МиБ с сохранением Range/HEAD и передаст байты нативному плееру.
Это отдельное явное разрешение: оно не следует из `userAgentProfile: browser`,
не наследуется редиректами и не включается автоматически для других источников.
JavaScript расширения не получает браузерных API или cookies.

### 5.1. Полный публичный контекст

Точные сигнатуры и поля DTO находятся в `sdk/index.d.ts`; это справочник
контракта, а не код, который нужно загружать в установленный пакет.

| API | Аргументы / результат |
| --- | --- |
| `sourceId`, `baseUrl`, `parameters` | Неизменяемые ID, базовый адрес и строковые параметры манифеста |
| `http.request` | `method`: GET/POST/HEAD; `url`; `responseType`: text/json/bytes; необязательные `headers`, `body`, `timeoutMs`, `authRevision`, `userAgentProfile` |
| Ответ HTTP | `{status, url, headers, body}`; `url` — конечный адрес; bytes — массив чисел 0–255 |
| `html.extract` | `(body, projection, baseUrl?)` → значение или массив; CSS-проекция, не DOM |
| `html.extractMany` | `(bodies, projection, baseUrl?)` → массив результатов в исходном порядке |
| `html.text` | `(bodies)` → массив текстов без HTML |
| `settings.network` | `()` → `{baseUrl, options}`; пользовательские настройки, только чтение |
| `settings.get/set` | `(key)` / `(key, JSON)`; собственные несекретные данные источника |
| `auth.status` | `()` → `{authorized, revision}` |
| `auth.getSession` | `({includeAccessToken?})` → `{authorized, revision, accessToken?}` |
| `log.info` | `(event, fields?)`; короткие несекретные JSON-данные |
| `crypto.aesGcmEncrypt` | `{key, plaintext}` → base64 envelope nonce(12)+ciphertext+tag(16) |
| `crypto.aesGcmDecrypt` | `{key, envelope}` → UTF-8 текст; ключ AES-256 в base64 |
| `crypto.pbkdf2Sha256` | `{password, salt, iterations, length}` → ключ base64; 1–200000 итераций, 1–64 байта |
| `crypto.aesCbcDecrypt` | `{key, iv, ciphertext}` в base64 → UTF-8 текст; PKCS7 |
| `crypto.chacha20DecryptCandidates` | `{keys, nonce, ciphertext}` в base64 → `(string|null)[]`; IETF counter=0, до 36 ключей и 64 КиБ ciphertext |
| `crypto.nonceSearch` | `[{prefix,targetHex}]` → числа nonce; SHA256(prefix + десятичный nonce) начинается с targetHex; работа ограничена хостом |

Проекция HTML поддерживает `selector`, `all`, `required`, `fields`, `text`,
`attr`, `html`, `outerHtml`, `tagName`, `absoluteUrl`, `textEquals`, `containsText`,
`ascend`, `nextSibling`, `directChildren`, `exclude`, `normalizeWhitespace`.
Используйте `required` только для обязательного элемента; отсутствие необязательной
картинки не должно уничтожать весь каталог. Для `absoluteUrl` передавайте конечный
адрес ответа, иначе относительная ссылка после редиректа разрешится неправильно.

POST с JSON передаёт объект в `body`; для HTML-формы передайте строку
`new URLSearchParams(fields).toString()` и `Content-Type: application/x-www-form-urlencoded`.
Сначала проверьте `status` и тип тела. Ответ 401/403/429 не является пустым каталогом;
HTML challenge не нужно пытаться читать как JSON. `timeoutMs` не продлевает общий
дедлайн операции. Cookies, Host и транспортные заголовки контролирует хост.

В среде есть `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder` и стандартные
операции JavaScript. Нет `fetch`, `document`, `window`, `localStorage`, файловой
системы, сокетов и произвольных нативных модулей. Зависимости должны собираться
в один ES-модуль; динамическая загрузка чужого исполняемого кода не разрешена.
Разрешение `crypto` предоставляет перечисленные операции, а не произвольный код.

## 6. Производительность, ошибки и проверки

Неизменяемые таблицы можно хранить на уровне модуля; данные одного запроса —
внутри метода. Не смешивайте разные страницы, базы и ревизии авторизации в кэше.
Объединяйте одинаковую выполняющуюся работу, ограничивайте размер и время жизни
кэша, удаляйте отклонённые promises. Независимые запросы выполняйте параллельно
в пределах `maxConcurrentRequests` (1–8). Не запускайте бесконтрольный `Promise.all`
по всем сериям или всем провайдерам. Для смены качества не загружайте каталог заново.

Обычный вызов ограничен 30 секундами; `sources[].runtime.resolveTimeoutMs`
может увеличить время resolver до 60 секунд. Не оставляйте работу после возврата
результата. Страница ограничена 200 карточками, фильтры — 64, варианты и субтитры —
128 каждого вида. HTTP-тело — до 4 МиБ, бинарное — до 1 МиБ.

Бросайте ошибки с `code`, например `network`, `not_found`, `auth_required`,
`challenge_required`, `parse_error`, `stream_unavailable`. Отмена, запрет доступа
и исчерпание лимита не должны запускать перебор всех провайдеров или повторять
запрос бесконечно. Логи содержат событие и несекретные параметры, без cookie,
токенов и подписанных ссылок.

Тесты размещаются в `tests/*.test.mjs`, используют `node:test`, фикстуры и mock
контекста. Минимальная проверка примера:

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

Перед выпуском проверьте первую/вторую/последнюю/пустую страницу, поиск, каждый
фильтр, детали, рекомендации, все плееры, озвучки, качества и субтитры. Добавьте
неверные ответы, 401/403/404/429/5xx, таймаут, отмену, редирект и пользовательскую
базу, включая относительные изображения. Проверьте интерфейс на ПК, телефоне и ТВ.

## 7. Расширение функции приложения

Для существующей функции не нужны `entrypoint`, `sources`, `resolvers` или
разрешения на исполнение. Пример TorrServer:

```json
{
  "schemaVersion": 1,
  "sourceApiVersion": 1,
  "minRuntimeAbi": 1,
  "id": "example.feature.torrserver",
  "name": "TorrServer",
  "description": "Открывает поддержку TorrServer",
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

Добавьте feature ID в `repository.json.hostFeatures` и область разрешений
издателя. Пакет включает готовые экраны и настройки; произвольное новое имя
функции не создаёт функциональность. Для нового типа функции сначала требуется
поддержка в публичном контракте приложения. Готовая структура — `examples/torrserver/`.

## 8. Упаковка и публикация

Создайте собственный Ed25519-ключ вне репозитория. Не используйте чужой ключ и
не добавляйте private key в Git, пакет, артефакты или логи.

```sh
node tools/pack.mjs keygen --private /secure/example-publisher.pem
node tools/pack.mjs --project sources/my_catalog --key /secure/example-publisher.pem --key-id example.publisher --version 1.0.0 --output dist/my-catalog-1.0.0.fxextension
```

Упаковщик собирает импорты, включает ресурсы, рассчитывает хэши, подписывает
манифест и проверяет результат. Это ещё не публикация. Для полного релиза:

```sh
node tools/release.mjs --key /secure/example-publisher.pem --key-id example.publisher --version 1.0.0 --output dist/release-1.0.0
```

Каталог назначения должен быть новым. Для собственного репозитория измените
`repository.json`: имя, канал (`standard`/`nsfw`), `publisherKeyId`, `sourceIds`
и `hostFeatures`. Указанный ID ключа должен совпадать с конфигурацией.

Публикация через приложенный `.github/workflows/release.yml`:

1. Создайте GitHub-репозиторий, настройте CI и environment `extensions-release`.
   Ограничьте, какие теги и участники могут запускать подписанный выпуск.
2. В environment задайте secret `FILMORAX_SIGNING_KEY_BASE64` — base64 файла
   PKCS8 PEM. Variables: `FILMORAX_PUBLISHER_KEY_ID` и
   `FILMORAX_PUBLISHER_FINGERPRINT` — SHA-256 сырых 32 байт публичного ключа,
   64 строчных hex-символа. Сохраните отпечаток отдельно от релиза.
3. Выполните `npm test`, `npm run format:check`, `npm run release:ci`.
   CI-комплект использует одноразовый ключ и не подходит для публичной установки.
4. Создайте SemVer-тег, например `v1.0.0`, на проверенном коммите и отправьте его.
   Ручной запуск требует существующий тег; версия без `v`, тег и коммит workflow
   должны совпадать. Версия комплекта применяется к пакетам при упаковке.
5. В GitHub Release должны находиться `.fxextension`, `release.json`,
   `release.ed25519`, `publisher.public.json`, `publisher.fingerprint.txt` и
   сопутствующие `.sha256`. Все файлы публикуются вместе.
6. Не заменяйте архив под существующей версией и не перезаписывайте релиз.
   Для изменения содержимого выпускайте новую SemVer-версию тем же ключом.
   Смена ключа или расширение разрешений требуют нового подтверждения доверия.

Пользователь открывает «Настройки → Расширения → Загрузить с GitHub» и вводит
`owner/repository` или ссылку `https://github.com/owner/repository`.
Можно указать ссылку на тег релиза. Приложение показывает до трёх последних
совместимых релизов и проверяет подписи и хэши автоматически; вручную вводить
SHA-256 или выбирать архив с диска не требуется. Пользователь выбирает релиз,
просматривает содержимое и разрешения, подтверждает доверие и импортирует пакеты.
Обновления не устанавливаются без подтверждения. Удаление записи репозитория
не удаляет уже установленные пакеты. Проверяйте установку, обновление и отключение
на отдельном тестовом профиле перед публикацией для всех пользователей.

### 8.1. Документация внутри пакета

В обоих репозиториях `docs/` содержит ровно два руководства: этот файл и его
английскую версию. Упаковщик автоматически добавляет их в каждый архив как
`assets/docs/extensions.ru.md` и `assets/docs/extensions.en.md`, включая пакет
TorrServer. Файлы включены в подписанный `files`; их изменение требует новой
упаковки и подписи. Не копируйте руководства вручную в каждый источник.

### 8.2. Разбор проблем и границы API

| Симптом / вопрос | Проверка / ответ |
| --- | --- |
| Нет каталога | Проверьте статус HTTP, конечный URL, зеркало, JSON-форму/HTML-селектор и `hasMore`; зафиксируйте обезличенный ответ тестом |
| Есть первая страница, нет второй | Убедитесь, что `page` используется и при поиске/фильтрах, URL второй страницы отличается, а `hasMore` берётся из реального признака |
| Фильтр ничего не делает | Сравните значения `selectedFilters` с параметрами сайта; UI не применяет фильтр самостоятельно |
| Отображаются ID жанров | Заполните читаемые `label` и metadata `value`, сохраните технический ID в `value` опции / `filterValue` метаданных |
| Пустой список серий | Проверьте все сезоны, пагинацию API, ответ `loadPlaybackGroups` и непустые episode URL; не путайте iframe и видео |
| Плеер недоступен | Проверьте прямую ссылку/манифест, MIME, срок подписи, Referer, объявленные stream origins; не добавляйте неработающие варианты ради количества |
| Нет субтитров | Проверьте фактический текст VTT/SRT/ASS, MIME, заголовки и доступ к URL; default-дорожка должна иметь `isDefault:true` |
| После смены зеркала старые данные | Уберите жёсткий домен, ключуйте/сбрасывайте кэш по настройкам и используйте конечный URL ответа |
| `permission_denied` | Сверьте permission, точный origin, методы HTTP, source/resolver scope и действующую авторизацию |
| `invalid_response` / `parse_error` | Проверьте строгие поля DTO, дубли ID, конечные числа, лимиты, тип тела и обязательные элементы |
| `auth_session_changed` / `cancelled` | Завершите операцию; не запускайте повторный fan-out по провайдерам |
| Можно добавить новую нативную функцию? | Пакет может включать только известный `hostFeature`; новый идентификатор требует реализации и поддержки приложения |
| Можно менять интерфейс произвольным кодом? | Нет. Пакет отдаёт данные/фильтры/настройки и декларации функций; экраны принадлежат приложению |
| Можно автоматом доверять ключу с GitHub? | Нет. Подпись проверяет целостность/идентичность; доверие издателю подтверждает пользователь |
| Можно обновить без новой версии? | Нет. Публикуйте новый SemVer и неизменяемый release; не перезаписывайте старые артефакты |

Проверяйте минимум Windows, Android и ТВ: формы должны иметь короткие понятные
названия и не зависеть от курсора. Переключение источника/профиля/авторизации во
время запроса не должно возвращать данные старой сессии. Интернет-тесты держите
отдельно от детерминированных фикстур; не храните чужие cookies, токены, видео или
необезличенные ответы. Лицензии кода и иконок сохраняйте вместе с происхождением.
