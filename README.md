# Uptime App

Создание точек мониторинга: на главной странице нажмите «Добавить сайт», укажите HTTP/HTTPS URL и частоту опроса от 1 до 1440 минут, затем нажмите «Создать». Точка сохраняется в PostgreSQL и остаётся в списке после перезагрузки. Статус «Ещё не проверялся» означает, что проверки доступности пока не выполняются. Контракт API и проверки описаны в [docs/monitoring-points.md](docs/monitoring-points.md).

Репозиторий состоит из двух приложений: `frontend/` (Next.js) и `backend/` (Go).

## Локальный запуск

Фронтенд (Node.js 20.9 или новее):

```powershell
cd frontend
npm install
npm run dev
```

Фронтенд откроется на <http://localhost:3000>.
Фронтенд написан на TypeScript. Проверки запускаются командами `npm test`, `npm run typecheck` и `npm run build` из каталога `frontend/`.

Браузерные проверки дашборда: один раз установите Chromium командой `npx playwright install chromium`, затем запустите `npm run test:e2e` из `frontend/`. Тесты сами запускают Next.js на порту 3100 и подменяют ответы API: проверяют меню профиля, успешный выход на страницу логина, ошибку выхода и повторную попытку на мобильном экране. Скриншоты сохраняются в `frontend/test-results/`.

Фронтенд обращается к API по `http://localhost:8080`. Если backend работает на другом адресе, создайте `frontend/.env.local` по образцу [frontend/.env.example](frontend/.env.example) и укажите `NEXT_PUBLIC_API_URL`. После изменения переменной перезапустите `npm run dev`. Адрес браузерного клиента должен совпадать с `CLIENT_ORIGIN` на backend.

Бэкенд (Go 1.25 или новее): запустите свой контейнер PostgreSQL в Docker Desktop, затем выполните из корня репозитория:

```powershell
.\start-backend.cmd
```

При первом запуске команда создаст локальный `backend/.env`: возьмёт настройки PostgreSQL из корневого `.env` и сгенерирует случайный JWT-секрет. Если пароль PostgreSQL не задан, запросит его один раз. По умолчанию используются пользователь и база `uptime`, адрес `localhost:55432`, как в `compose.yaml`. Для другого контейнера измените `DATABASE_URL` в `backend/.env`. Файл сохраняется между запусками и исключён из Git. Переменные текущего окружения имеют приоритет над файлами.

Повторный запуск — та же команда `.\start-backend.cmd`; остановка — `Ctrl+C`. Скрипт запускает только Go, контейнеры не создаёт и не запускает.

Проверка скрипта запуска в Windows: `node --test backend/test/dev-launcher.test.cjs` из корня репозитория. Тест использует временные настройки и подменяет команду Go, не подключаясь к PostgreSQL.

Если контейнер PostgreSQL ещё не создан, его можно создать один раз через Docker Compose:

```powershell
# Из корня репозитория, после настройки POSTGRES_PASSWORD в корневом .env.
docker compose up -d postgres
```

Сервер доступен на <http://localhost:8080>. При запуске GORM создаёт таблицы пользователей и refresh-сессий через AutoMigrate. Данные PostgreSQL сохраняются в Docker volume. PostgreSQL настроен с `restart: always`: существующий контейнер автоматически запускается вместе с Docker Desktop и перезапускается при сбое. Команда `docker compose down` удаляет контейнер; после неё нужно снова выполнить `docker compose up -d postgres`. Настройки Compose перечислены в [.env.example](.env.example), а настройки backend — в [backend/.env.example](backend/.env.example). Команда `start-backend.cmd` загружает `backend/.env`; при прямом запуске `go run ./cmd/server` переменные окружения нужно задать самостоятельно.

Для HTTPS задайте `COOKIE_SECURE=true`. В рабочем окружении `JWT_SECRET` должен быть случайным секретом, а `CLIENT_ORIGIN` — точным адресом браузерного клиента.

## Документация API

Swagger UI доступен после запуска backend по адресу <http://localhost:8080/swagger/index.html>.
Контракт OpenAPI 3.0: [backend/docs/openapi.json](backend/docs/openapi.json), также доступен по HTTP на `/swagger/openapi.json`.
Аннотации Swaggo описывают все 10 операций, параметры, ответы, ошибки и авторизацию. Промежуточные файлы Swagger 2.0 находятся в `backend/docs/swagger.json` и `swagger.yaml`.

После изменения обработчиков или аннотаций обновите контракт из каталога `backend/`:

```powershell
go generate ./cmd/server
.\generate-redoc.cmd
go test ./...
go build ./cmd/server
```

Версия Swaggo закреплена в `go.mod`; отдельная установка CLI не нужна. Генерация не требует PostgreSQL. Сначала Swaggo создаёт Swagger 2.0, затем `cmd/openapi` преобразует его в OpenAPI 3.0, добавляет отдельную JSON-схему обновления профиля, cookie-параметры и HTTP Bearer JWT, проверяет корректность контракта. При изменении форматов профиля обновляйте также преобразователь.

ReDoc: [backend/docs/redoc.html](backend/docs/redoc.html). Файл содержит контракт и скрипты ReDoc, его можно открыть в браузере без запуска backend. Для повторной генерации из существующего `docs/openapi.json` выполните `.\generate-redoc.cmd` из `backend/` (или `backend\generate-redoc.cmd` из корня). Команда использует закреплённую версию Redocly CLI 2.72.0 через `npx.cmd`; нужны Node.js 22.12+ или 20.19–20.x, npm 10+ и доступ к сети для загрузки инструментов и сборки ReDoc.

В Swagger UI для защищённых операций нажмите Authorize и вставьте access JWT. Refresh и logout используют HTTP-only cookie, полученную при регистрации или входе в том же браузере.

## API авторизации

Все маршруты начинаются с `/api/auth`. Регистрация и вход принимают JSON `{"email":"user@example.com","password":"password123"}`. Email приводится к нижнему регистру; пароль должен содержать от 8 до 72 байт.

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/register` | Создать пользователя и сессию |
| POST | `/login` | Войти и создать сессию |
| POST | `/refresh` | Заменить refresh-токен и выдать новый access JWT |
| POST | `/logout` | Отозвать текущую refresh-сессию |
| GET | `/me` | Получить пользователя по access JWT |
| PATCH | `/me` | Сохранить имя и аватар текущего пользователя по access JWT |
| GET | `/avatars/{filename}` | Получить сохранённый аватар (публичный URL) |

Регистрация возвращает 201, вход и обновление — 200. Формат успешного ответа:

```json
{
  "user": {"id": 1, "email": "user@example.com", "name": ""},
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Access JWT передаётся в `Authorization: Bearer <JWT>`; `GET /me` возвращает `{"id":1,"email":"user@example.com","name":""}`. Refresh-токен находится только в HTTP-only cookie `refresh_token`, поэтому браузерный клиент должен отправлять запросы с `credentials: "include"`. Cookie действует 30 дней, имеет `SameSite=Lax` и путь `/api/auth`. Каждый успешный `POST /refresh` заменяет refresh-токен; старый после этого недействителен. `POST /logout` возвращает 204 и очищает cookie.

Ошибки возвращаются как `{"error":{"code":"invalid_request","message":"..."}}`. Возможные коды: `invalid_request` (400), `email_taken` (409), `invalid_credentials` и `invalid_token` (401), `origin_not_allowed` (403), `internal_error` (500). Подтверждение email и восстановление пароля пока не реализованы.

Планы и чеклисты находятся в [docs/plans/auth-backend-plan.md](docs/tmp/plans/auth-backend-plan.md) и [docs/plans/auth-frontend-plan.md](docs/tmp/plans/auth-frontend-plan.md).

## Аватар профиля

В разделе «Мой профиль» выберите PNG или JPEG, проверьте предпросмотр и нажмите «Сохранить». Имя и аватар сохраняются одним запросом; при ошибке выбранный файл остаётся для повторной попытки. После сохранения аватар обновляется в профиле и шапке, включая переходы между страницами и перезагрузку.

`PATCH /api/auth/me` по-прежнему принимает JSON `{"name":"Анна"}`. Для сохранения аватара отправляйте `multipart/form-data` с одним файлом `avatar` и необязательным текстовым полем `name` (1–100 символов после удаления пробелов по краям). Если `name` отсутствует, текущее имя сохраняется: загрузить аватар можно и новому пользователю без имени. Требуется `Authorization: Bearer <JWT>`. Максимальный размер файла — 5 МиБ, изображения — 16 миллионов пикселей; проверяется содержимое PNG/JPEG. Некорректный файл возвращает 400 с кодом `invalid_avatar`, превышение размера — 413 с кодом `avatar_too_large`. Ответ пользователя во всех методах авторизации содержит дополнительное поле `avatar_url`: пустую строку или путь `/api/auth/avatars/<случайное имя>.png` относительно адреса API.

Сервер перекодирует изображение в PNG и сохраняет в `backend/uploads/avatars/` при запуске из `backend/`. Папка создаётся автоматически, исключена из Git и должна сохраняться между запусками вместе с базой данных. Её можно изменить переменной `AVATAR_DIR` (абсолютный путь или относительно рабочего каталога сервера). Старый файл удаляется после успешной замены. Файлы доступны через `GET /api/auth/avatars/{filename}` без токена; каждый новый аватар получает новый URL.

Проверки загрузки: `go test ./...` из `backend/`, `npm test` и `npm run test:e2e` из `frontend/`. Браузерный тест проверяет предпросмотр, повтор после ошибки, обновление шапки, переходы и перезагрузку; снимки — `frontend/test-results/avatar-desktop.png` и `avatar-mobile.png`.

