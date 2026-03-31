# PlayMax

Извлекает историю школьных родительских чатов из [VK Max](https://web.max.ru/), анализирует с помощью LLM и отправляет дайджест важных событий в Telegram.

## Требования

- [Bun](https://bun.sh/) >= 1.0
- Google Chrome (Playwright использует установленный браузер)

## Установка

```bash
bun install
```

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

### 1. Авторизация

Откройте браузер и залогиньтесь на web.max.ru вручную. Сессия сохранится в `./chrome-profile`.

```bash
bun index.ts login
```

После входа нажмите `Ctrl+C`.

### 2. Синхронизация

Загрузите список чатов из папки "Сферум" и историю сообщений в SQLite (`playmax.db`).

```bash
bun index.ts sync
```

Скрипт:
- Получает список чатов (кэшируется по TTL)
- Для каждого чата скроллит историю вверх до ранее загруженных сообщений
- Сохраняет сообщения в базу с дедупликацией

### 3. Анализ

Отправляет новые (неанализированные) сообщения в LLM, получает структурированные события, отправляет дайджест в Telegram.

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
browser.ts        - Standalone браузер для отладки
ANALYZE.md        - Системный промпт для LLM
.mcp.json         - Конфигурация chrome-devtools MCP
playwright.config.ts - Конфигурация Playwright (тесты)
```

## База данных

SQLite (`playmax.db`) с двумя таблицами:

- **chats** - `id`, `name`, `url`, `added_at`
- **messages** - `chat_id`, `date`, `time`, `author`, `text`, `added_at`, `is_analyzed`

Миграции выполняются автоматически при открытии БД.
