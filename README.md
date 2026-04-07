# PlayMax

Извлекает историю школьных родительских чатов из [VK Max](https://web.max.ru/), анализирует с помощью LLM и отправляет дайджест важных событий в Telegram.

## Требования

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) для периодических запусков `sync` и `analyze`
- Для первого входа не нужен системный Chrome: достаточно установить Playwright Chromium

## Установка

```bash
bun install
bunx playwright install chromium
```

Создать браузерный профиль:

```bash
bun index.ts login
```

На macOS локальный `login` автоматически использует установленный `Google Chrome`, если он найден. Это обход проблемы, при которой bundled `Chrome for Testing` может падать при старте. Docker-запуски `sync` и `analyze` по-прежнему используют Chromium внутри контейнера и не требуют браузера на хосте.

## Настройка

Создайте `.env` в корне проекта:

```env
# OpenAI-совместимый API для анализа сообщений
OPENAI_API_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=sk-...
OPENAI_API_MODEL=gpt-4o-mini

# Telegram бот для отправки дайджестов
BOT_TOKEN=123456:ABC...
CHAT_ID=123456789
```

Опциональные переменные:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `CHAT_LIST_TTL_MS` | `86400000` (1 день) | Как часто обновлять список чатов |
| `CHAT_HISTORY_TTL_MS` | `300000` (5 мин) | Как часто обновлять историю сообщений |
| `MIN_NEW_MESSAGES` | `3` | Минимум новых сообщений для запуска анализа |

## Использование

### 1. Первый запуск: авторизация и профиль браузера

Откройте Playwright Chromium и залогиньтесь на `web.max.ru` вручную. Профиль сохранится в `./chrome-profile`.

```bash
bun index.ts login
```

После входа нажмите `Ctrl+C`.

### 2. Первый `sync`: создание базы данных

База `playmax.db` создается автоматически при первом `sync` или `analyze`. После логина можно сразу переходить к контейнерному запуску: первый `make docker-sync` создаст базу, если файла еще нет.

### 3. Периодические запуски в Docker

Соберите stateless-образ. Код и Chromium живут внутри образа, а `.env`, `chrome-profile/` и `playmax.db` пробрасываются с хоста.

```bash
make docker-build
```

Запуск синхронизации:

```bash
make docker-sync
```

Запуск анализа:

```bash
make docker-analyze
```

Контейнер запускается с `--rm`, поэтому остается stateless: все состояние сохраняется только в примонтированном каталоге проекта.

## Deployment

### Стратегия

Артефакты деплоя:
- Docker image с кодом приложения и headless Chromium
- `chrome-profile/` с уже авторизованной сессией `web.max.ru`
- `playmax.db` с накопленной историей и флагами `is_analyzed`
- `.env` с ключами LLM и Telegram

Рекомендуемая схема:
- image считать immutable-артефактом и публиковать в registry или переносить через `docker save`
- `chrome-profile/`, `playmax.db` и `.env` хранить в отдельном каталоге состояния, например `/opt/playmax/state`
- контейнер запускать только через `docker run --rm`, без записи внутрь образа

### Сборка и перенос

На машине разработки:

```bash
DOCKER_PLATFORM=linux/amd64 make docker-build
docker save playmax:latest | gzip > playmax-image-linux-amd64.tar.gz
```

На сервере:

```bash
mkdir -p /opt/playmax/state
gunzip -c playmax-image-linux-amd64.tar.gz | docker load
```

Если сервер `x86_64`, образ тоже должен быть `linux/amd64`. Если собрать image на Apple Silicon без `--platform linux/amd64`, получится `linux/arm64`-образ, и на обычном Linux-сервере Docker запустит его через эмуляцию. Для Playwright Chromium это часто заканчивается падением браузера на старте. Предупреждение вида `requested image's platform (linux/arm64) does not match ... (linux/amd64)` означает, что артефакт собран не под ту архитектуру.

Перенесите в `/opt/playmax/state` файлы и каталоги:

```bash
.env
playmax.db
chrome-profile/
```

### Ручной запуск на сервере

Синхронизация:

```bash
docker run --rm --init \
  --env-file /opt/playmax/state/.env \
  -e PLAYMAX_STATE_DIR=/state \
  -v /opt/playmax/state:/state \
  playmax:latest bun run sync
```

Анализ:

```bash
docker run --rm --init \
  --env-file /opt/playmax/state/.env \
  -e PLAYMAX_STATE_DIR=/state \
  -v /opt/playmax/state:/state \
  playmax:latest bun run analyze
```

### Пример crontab

Ниже пример для Linux-хоста, где `sync` запускается каждые 30 минут, а `analyze` через 5 минут после него. `flock` не дает задачам пересекаться.

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

*/30 * * * * flock -n /tmp/playmax-sync.lock docker run --rm --init --env-file /opt/playmax/state/.env -e PLAYMAX_STATE_DIR=/state -v /opt/playmax/state:/state playmax:latest bun run sync >> /var/log/playmax-sync.log 2>&1
5,35 * * * * flock -n /tmp/playmax-analyze.lock docker run --rm --init --env-file /opt/playmax/state/.env -e PLAYMAX_STATE_DIR=/state -v /opt/playmax/state:/state playmax:latest bun run analyze >> /var/log/playmax-analyze.log 2>&1
```

Если image публикуется в registry, перед обновлением достаточно выполнить `docker pull <registry>/playmax:<tag>` и затем продолжать те же cron-запуски с новым тегом.

### Публикация в GitHub Container Registry

В репозитории настроен workflow [`docker-publish.yml`](/Users/ivan/projects/temp/playmax/.github/workflows/docker-publish.yml), который собирает Docker image и публикует его в GHCR.

Что делает workflow:
- на `push` в `main` или `master` публикует теги ветки, SHA и `latest` для default branch
- на git-теги вида `v*` публикует одноименный image tag
- на `pull_request` только проверяет, что образ собирается, без публикации
- по `workflow_dispatch` позволяет запустить сборку вручную

Итоговый образ публикуется по адресу:

```bash
ghcr.io/<owner>/<repo>:latest
```

Примеры тегов:

```bash
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:main
ghcr.io/<owner>/<repo>:sha-<commit>
ghcr.io/<owner>/<repo>:v1.0.0
```

Для работы публикации:
- Actions в репозитории должны быть включены
- workflow использует встроенный `GITHUB_TOKEN`, дополнительных secrets для GHCR не требуется
- у организации или пользователя должна быть разрешена публикация пакетов в GitHub Container Registry

Проверить и скачать образ можно так:

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```

### GitHub Release по тегу

Workflow [`release.yml`](/Users/ivan/projects/temp/playmax/.github/workflows/release.yml) запускается при пуше git-тега вида `v*` и собирает standalone-бинарь для Linux `amd64`.

Что попадает в релиз:
- `playmax-linux-amd64.tar.gz`
- `playmax-linux-amd64.tar.gz.sha256`

Пример выпуска релиза:

```bash
git tag v1.0.0
git push origin v1.0.0
```

После этого GitHub Actions создаст или обновит GitHub Release с тегом `v1.0.0` и прикрепит собранные артефакты.

### 4. Что делают команды

`sync`:
- Получает список чатов из папки `Сферум` с учетом TTL-кэша
- Догружает историю сообщений и сохраняет ее в `playmax.db`

`analyze`:
- Берет новые сообщения из базы
- Отправляет их в LLM
- Публикует дайджест в Telegram

```bash
bun index.ts analyze
```

### Отладка через MCP

Для работы с chrome-devtools MCP запустите браузер отдельно:

```bash
bun browser.ts
```

Браузер откроется с CDP на порту 9222. MCP-сервер настроен в `.mcp.json`.

## Структура проекта

```
index.ts          - CLI точка входа (login | sync | analyze)
login.ts          - Авторизация через persistent browser
sync.ts           - Загрузка чатов и сообщений
analyze.ts        - LLM-анализ + отправка в Telegram
db.ts             - SQLite слой (bun:sqlite)
runtime.ts        - Пути состояния и общие Playwright-настройки
browser.ts        - Standalone браузер для отладки
ANALYZE.md        - Системный промпт для LLM
.mcp.json         - Конфигурация chrome-devtools MCP
playwright.config.ts - Конфигурация Playwright (тесты)
Dockerfile        - Образ для headless sync/analyze
```

## База данных

SQLite (`playmax.db`) с двумя таблицами:

- **chats** - `id`, `name`, `url`, `added_at`
- **messages** - `chat_id`, `date`, `time`, `author`, `text`, `added_at`, `is_analyzed`

Миграции выполняются автоматически при открытии БД.
