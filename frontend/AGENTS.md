# Правила для фронтенда

## Структура

В этом каталоге находится приложение Next.js на TypeScript. Файл `app/page.tsx` задаёт главную страницу, а `app/layout.tsx` — корневой макет и метаданные. Добавляйте маршруты в `app/` по соглашениям Next.js. Ресурсы храните рядом с использующим их кодом или в `public/`, если нужен постоянный URL.

## Разработка и сборка

Используйте Node.js 20.9 или новее. Выполняйте команды из этого каталога:

- `npm install` — установить зависимости из `package-lock.json`.
- `npm run dev` — запустить сервер разработки на `http://localhost:3000`.
- `npm run build` — проверить и собрать приложение для продакшена.
- `npm run typecheck` — проверить типы TypeScript.
- `npm test` — запустить тесты клиента авторизации.
- `npm run start` — запустить собранное приложение.

## Стиль кода и тесты

Следуйте существующему стилю TSX: отступы в два пробела и точки с запятой. Именуйте компоненты React в `PascalCase`, а файлы маршрутов — по соглашениям Next.js, например `page.tsx` и `layout.tsx`. Для новых интерфейсов и данных API задавайте явные типы, не используйте `any`. Форматтер и линтер пока не настроены. Для нового поведения при необходимости добавляйте тесты; перед отправкой изменений выполняйте `npm test`, `npm run typecheck` и `npm run build`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
