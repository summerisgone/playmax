ARG BUN_IMAGE=oven/bun:1.3.11
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.58.2-noble

FROM ${BUN_IMAGE} AS bun

FROM ${PLAYWRIGHT_IMAGE} AS runtime

WORKDIR /app

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx && bun --version

ENV PLAYWRIGHT_IN_DOCKER=1
ENV PLAYMAX_STATE_DIR=/state
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY ANALYZE.md ./
COPY analyze-schema.ts analyze.ts browser.ts db.ts index.ts llm-images.ts login.ts runtime.ts sync.ts ./

CMD ["bun", "run", "start"]
