FROM oven/bun:1 AS base

WORKDIR /app

ENV PLAYWRIGHT_IN_DOCKER=1
ENV PLAYMAX_STATE_DIR=/state
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

FROM base AS deps

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS browser

RUN bunx playwright install --with-deps chromium

FROM browser AS runtime

COPY tsconfig.json ./
COPY ANALYZE.md ./
COPY analyze-schema.ts analyze.ts browser.ts db.ts index.ts llm-images.ts login.ts runtime.ts sync.ts ./

CMD ["bun", "run", "start"]
