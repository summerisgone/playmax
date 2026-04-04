FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock tsconfig.json playwright.config.ts ./
RUN bun install --frozen-lockfile
RUN bunx playwright install --with-deps chromium

COPY . .

ENV PLAYWRIGHT_IN_DOCKER=1
ENV PLAYMAX_STATE_DIR=/state

CMD ["bun", "run", "start"]
