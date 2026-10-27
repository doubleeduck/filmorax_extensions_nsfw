# FilmoraX Extensions

Репозиторий NSFW-источников. Источники реализованы на JavaScript и поставляются
подписанными пакетами `.fxextension` через GitHub Releases.

- [Полное руководство разработчика (RU)](docs/extensions.ru.md)
- [Complete developer guide (EN)](docs/extensions.en.md)
- [Типы публичного API](sdk/index.d.ts)
- Происхождение и лицензии: [код](PROVENANCE.md), [иконки](ICON_PROVENANCE.md).

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm test
npm run format:check
```

Установка в FilmoraX: «Настройки» → «Расширения» → «Загрузить с GitHub».
Укажите `owner/repository` или ссылку на репозиторий/релиз, выберите релиз,
проверьте издателя и разрешения, подтвердите доверие и импорт.
Контрольные суммы вычисляются автоматически, вручную их вводить не нужно.

Публикация настраивается через `repository.json` и `.github/workflows/release.yml`.
В руководствах описаны ключи, GitHub Environment/secrets, SemVer, проверка подписи
и выпуск неизменяемых релизов. Ключ подписи хранится вне Git. Каждый пакет
автоматически включает оба руководства в подписанных `assets/docs/`.
