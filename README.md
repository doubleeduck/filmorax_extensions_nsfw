# FilmoraX NSFW Extensions

Самостоятельный release-репозиторий расширений FilmoraX. Канал: **nsfw**.
Источников: 7. IDs: adulttube, animefox, anitokyo_nsfw, eporner, porno365, watchhentai, xhamster.
TorrServer и обычных источников в этом канале нет.
Никакие Dart/APK/native-плагины не скачиваются: источники — подписанные JS-пакеты;
TorrServer — декларативное открытие app-owned функции хоста, без WebView-плеера.

## Проверки и разработка

Нужен Node 22+. Все зависимости фиксированы package-lock.json:

```powershell
npm ci --ignore-scripts
npm rebuild esbuild
npm test
npm run format:check
```

Исходники находятся в `sources/`, общий движок — в `engines/`, providers — в
`resolvers/`, типы SDK — в `sdk/index.d.ts`. `examples/demo/` — полный offline
пример API без реальных видео. `repository.json` явно ограничивает source IDs,
host features и NSFW-классификацию. Новый источник нужно добавить и в allowlist.

Здесь нет зависимости от соседнего каталога FilmoraX или второго канала.
SDK/tooling первоначально синхронизированы воспроизводимым генератором из
`filmorax/extensions/tools/split_repositories.mjs`. `toolkit-snapshot.json`
позволяет сверять общий toolkit, но не является подписью издателя. Существующие
репозитории генератор не перезаписывает: дальнейшие изменения переносятся с
просмотром diff, чтобы не затереть локальную разработку.

## Настройка GitHub Releases (один раз в каждом репозитории)

1. Создайте GitHub-репозиторий для этого каталога и добавьте файлы в Git. Git
   history и remote здесь намеренно не создаются автоматически.
2. В Settings → Environments создайте **extensions-release**. Настройте reviewers
   и разрешённые release tags/branches; YAML не может сам включить эти ограничения.
3. Во внешнем безопасном месте создайте собственный Ed25519 private key, например:
   `node tools/pack.mjs keygen --private D:/private/filmorax.sources.nsfw.pem`.
   Этот ключ НЕ должен попадать в репозиторий. Для двух каналов лучше использовать
   разные ключи и разные Environment secrets. Готовый production key не приложен.
4. В Environment задайте secret **FILMORAX_SIGNING_KEY_BASE64** — base64 всех байтов
   PKCS8 PEM private key. Файл ключа никогда не нужен в GitHub workspace: подпись
   выполняется в памяти, secret удаляется из окружения до запуска дочерних процессов.
5. Задайте Environment variable **FILMORAX_PUBLISHER_KEY_ID** = `filmorax.sources.nsfw` (как в
   repository.json), а **FILMORAX_PUBLISHER_FINGERPRINT** — SHA-256 raw 32-byte
   Ed25519 public key (64 строчных hex). Его необходимо сохранить независимо от
   release assets и передавать пользователям через доверенный канал.
6. Для проверки public record можно собрать локальный комплект:
   `node tools/release.mjs --key D:/private/filmorax.sources.nsfw.pem --key-id filmorax.sources.nsfw --version 1.0.0 --output dist/local-1`.
   Public record и fingerprint будут внутри dist/local-1. Сам факт получения ключа
   рядом с архивом не доказывает подлинность и не даёт приложению автоматического trust.

## Выпуск

После успешного CI создайте и отправьте существующий tag `v1.0.0` на проверенный
commit. Релиз запускается по v-tag или вручную с version без `v`; checkout HEAD,
tag и GITHUB_SHA обязаны совпадать. Иначе подписи и публикации не будет.

Версия Git tag применяется ко всем пакетам комплекта в памяти — authoring
manifests не переписываются. Подписи воспроизводимы; повторная публикация не
перезаписывает существующий GitHub Release. Pre-release версии помечаются явно.

Release содержит `.fxextension`, отдельные SHA-256, `publisher.public.json`,
`publisher.fingerprint.txt`, подписанные `release.json` / `release.ed25519`.
Перед публикацией подписи, классификация, inventory, fingerprint и каждый архив
проверяются ещё раз без private key. CI использует только одноразовый тестовый
ключ: его artifacts не являются production/trusted релизом.

В FilmoraX импортируйте public record, независимо сверьте fingerprint, затем
устанавливайте нужные fxextension с подтверждением разрешений. NSFW-пакеты
не устанавливаются в сборку без NSFW. Установка идёт в текущий профиль.

Поддержка runtime хоста: Windows/Android; iOS/macOS/Linux ещё требуют реализации.
Native/user credentials никогда не должны попадать в исходники, DTO или логи.
