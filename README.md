# PlayMax

`playmax` забирает сообщения из школьных чатов в МАХ, сохраняет их в SQLite, прогоняет через LLM и отправляет короткий дайджест в Telegram.

Рабочая схема такая:

1. Один раз локально создаём браузерный профиль и логинимся в `web.max.ru`.
2. Дальше запускаем `sync` и `analyze` из публичного Docker image.
3. Весь state живёт вне контейнера: `.env`, `chrome-profile/`, `playmax.db`, `message-media/`.

## Что понадобится

- [Bun](https://bun.sh/) для одноразового локального `login`
- [Docker](https://www.docker.com/) для регулярных `sync` и `analyze`
- Google Chrome на macOS, если хотите использовать системный браузер для логина

Локальный `login` на macOS автоматически выбирает системный `Google Chrome`, если он установлен. Если Chrome не найден, будет использован Playwright Chromium.

## Быстрый старт

### 1. Установить зависимости

```bash
bun install
```

Если системного Chrome нет и нужен fallback на Playwright Chromium:

```bash
bunx playwright install chromium
```

### 2. Подготовить каталог состояния

Удобно держать всё состояние вне репозитория, например в `~/playmax-state`.

```bash
export STATE_DIR="$HOME/playmax-state"
mkdir -p "$STATE_DIR"
```

Создайте `$STATE_DIR/.env`:

```env
# OpenAI-совместимый API для анализа
OPENAI_API_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=sk-...
OPENAI_API_MODEL=gpt-4o-mini

# Telegram
BOT_TOKEN=123456:ABC...
CHAT_ID=123456789
```

Опциональные переменные:

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `CHAT_LIST_TTL_MS` | `86400000` | Как часто обновлять список чатов |
| `CHAT_HISTORY_TTL_MS` | `300000` | Как часто обновлять историю сообщений |
| `MIN_NEW_MESSAGES` | `3` | Минимум новых сообщений для запуска `analyze` |

### 3. Создать профиль и залогиниться

```bash
PLAYMAX_STATE_DIR="$STATE_DIR" bun run login
```

Что произойдёт:

- откроется браузер с persistent profile
- профиль сохранится в `$STATE_DIR/chrome-profile`
- в консоли будет показано, какой браузер реально запущен

Дальше:

1. Войдите в `https://web.max.ru/`.
2. Убедитесь, что нужные чаты видны.
3. Нажмите `Ctrl+C`.

После этого в `$STATE_DIR` должен появиться каталог `chrome-profile/`.

## Docker: рабочий цикл `sync -> analyze`

После логина локальный Bun больше не нужен. Дальше можно пользоваться публичным образом:

```bash
docker pull ghcr.io/summerisgone/playmax:latest
```

### Разовый `sync`

```bash
docker run --rm --init \
  --env-file "$STATE_DIR/.env" \
  -e PLAYMAX_STATE_DIR=/state \
  -v "$STATE_DIR:/state" \
  ghcr.io/summerisgone/playmax:latest \
  bun run sync
```

Что делает `sync`:

- открывает браузер внутри контейнера
- использует уже сохранённую сессию из `/state/chrome-profile`
- создаёт или обновляет `/state/playmax.db`
- сохраняет медиа в `/state/message-media`, если они есть

### Разовый `analyze`

```bash
docker run --rm --init \
  --env-file "$STATE_DIR/.env" \
  -e PLAYMAX_STATE_DIR=/state \
  -v "$STATE_DIR:/state" \
  ghcr.io/summerisgone/playmax:latest \
  bun run analyze
```

Что делает `analyze`:

- берёт новые сообщения из `/state/playmax.db`
- отправляет их в LLM
- публикует дайджест в Telegram
- помечает обработанные сообщения как `is_analyzed`

## Что лежит в каталоге состояния

После первого полного цикла у вас будет примерно такая структура:

```text
$STATE_DIR/
  .env
  chrome-profile/
  playmax.db
  message-media/
```

Именно этот каталог нужно бэкапить и монтировать в контейнер.

## Автозапуск по cron

Пример для Linux-хоста: `sync` каждые 5 минут, `analyze` через 30 минут. `flock` не даёт двум запускам пересечься.

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

*/30 * * * * flock -n /tmp/playmax-sync.lock docker run --rm --init --env-file /home/user/playmax-state/.env -e PLAYMAX_STATE_DIR=/state -v /home/user/playmax-state:/state ghcr.io/summerisgone/playmax:latest bun run sync >> /var/log/playmax-sync.log 2>&1
5,35 * * * * flock -n /tmp/playmax-analyze.lock docker run --rm --init --env-file /home/user/playmax-state/.env -e PLAYMAX_STATE_DIR=/state -v /home/user/playmax-state:/state ghcr.io/summerisgone/playmax:latest bun run analyze >> /var/log/playmax-analyze.log 2>&1
```

## Локальные команды разработки

- `bun run login` - открыть браузер и сохранить сессию
- `bun run sync` - синхронизировать чаты локально
- `bun run analyze` - выполнить анализ локально
- `bun run browser` - открыть браузер для MCP/CDP-отладки
- `bun test` - запустить тесты
- `make build` - собрать standalone binary в `build/playmax`

## Публикация Docker image

Workflow [`docker-publish.yml`](/Users/ivan/projects/temp/playmax/.github/workflows/docker-publish.yml) публикует образ в GHCR:

```text
ghcr.io/summerisgone/playmax:latest
```

Также публикуются branch/tag/SHA-теги. Сборка идёт под `linux/amd64`.

## Структура проекта

```text
index.ts       CLI entrypoint
login.ts       локальный логин и сохранение браузерной сессии
sync.ts        загрузка чатов и сообщений в SQLite
analyze.ts     LLM-анализ и отправка дайджеста в Telegram
db.ts          SQLite слой
runtime.ts     общие пути состояния и Playwright runtime options
browser.ts     браузер для локальной отладки через CDP
ANALYZE.md     системный prompt для LLM
Dockerfile     runtime image для sync/analyze
```
