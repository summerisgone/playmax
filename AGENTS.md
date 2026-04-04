# Repository Guidelines

## Project Structure & Module Organization
This repository is a small Bun-based TypeScript CLI. Source files live at the repository root: [`index.ts`](/Users/ivan/projects/temp/playmax/index.ts) dispatches commands, [`login.ts`](/Users/ivan/projects/temp/playmax/login.ts) handles browser auth, [`sync.ts`](/Users/ivan/projects/temp/playmax/sync.ts) pulls chat history, [`analyze.ts`](/Users/ivan/projects/temp/playmax/analyze.ts) sends LLM summaries to Telegram, and [`db.ts`](/Users/ivan/projects/temp/playmax/db.ts) owns SQLite access. Prompt content lives in [`ANALYZE.md`](/Users/ivan/projects/temp/playmax/ANALYZE.md). Tests belong in `tests/`. Generated or local-only data includes `build/`, `chrome-profile/`, `.env`, and `playmax.db`.

## Build, Test, and Development Commands
- `bun install`: install dependencies.
- `bun run start`: show CLI usage.
- `bun run login`: open Chrome with the persistent profile for manual login.
- `bun run sync`: fetch chat metadata and messages into `playmax.db`.
- `bun run analyze`: analyze new messages and send the Telegram digest.
- `bun run browser`: start a browser for MCP/CDP debugging.
- `bun test` or `bun run test`: run Playwright tests from `tests/`.
- `make build`: compile a standalone binary into `build/playmax`.
- `make clean`: remove `build/`.

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode enabled. Follow the existing style: 2-space indentation, double quotes, semicolons, and small focused modules. Prefer named exports for command helpers such as `login`, `syncAll`, and `analyze`. Use `camelCase` for variables/functions, `SCREAMING_SNAKE_CASE` for env-derived constants like `CHAT_LIST_TTL_MS`, and keep new entrypoints at the root unless there is a clear need to introduce subdirectories.

## Testing Guidelines
Playwright is configured in [`playwright.config.ts`](/Users/ivan/projects/temp/playmax/playwright.config.ts) and looks for tests in `tests/`. Add specs as `*.spec.ts`. Keep tests deterministic and isolate browser state from the checked-in `chrome-profile/` flow unless a test explicitly covers that login path. There is no stated coverage gate yet; add regression tests for parsing, sync edge cases, and CLI behavior when changing those areas.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects, often in Russian, for example `Исправил sync логику` and `sync in headless mode`. Keep commits narrowly scoped and descriptive. Pull requests should include a short summary, affected commands or env vars, manual verification steps, and screenshots or logs when browser automation behavior changes.

## Security & Configuration Tips
Do not commit `.env`, `chrome-profile/`, or SQLite database files. Treat Telegram tokens and OpenAI-compatible API keys as secrets. When changing selectors against `web.max.ru`, document the affected page state and verify `login`, `sync`, and `analyze` still work end to end.
