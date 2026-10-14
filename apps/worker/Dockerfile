# Research-plane worker (SPEC.md §4), also used as the one-shot migration
# job (it carries the full workspace source and tsx). Decoupled from the web
# app by the Postgres-backed queue.
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS base

# Chromium for Playwright evidence capture (decision D).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# Ops scripts (provision-nyc, create-tenant, research-verify, …) run from this
# image: `docker compose run --rm migrate node --import tsx ../../scripts/…`.
COPY scripts ./scripts
COPY principles ./principles
COPY architecture ./architecture
# The vendored plugin IS the research runtime (SPEC.md §5); CI pins its version.
COPY vendor ./vendor
ENV OPEN_DOUGHNUT_PLUGIN_DIR=/app/vendor/open-doughnut/plugin

RUN pnpm install --frozen-lockfile --filter @deep-fryer/worker... --filter "deep-fryer..."

# Never run research sessions (or the browser that renders untrusted pages)
# as root (SPEC-v3 §2.3). Source stays root-owned and read-only to `node`.
USER node
ENV NODE_ENV=production HOME=/home/node
WORKDIR /app/apps/worker

# Required at runtime: DATABASE_URL, ANTHROPIC_API_KEY, S3_* (evidence).
# Egress in production goes through the allowlist proxy (HTTPS_PROXY), which
# logs every fetched URL below the model — see apps/worker/README.md.
CMD ["node", "--import", "tsx", "src/index.ts"]
