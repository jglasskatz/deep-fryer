# Research-plane worker (SPEC.md §4), also used as the one-shot migration
# job (it carries the full workspace source and tsx). Decoupled from the web
# app by the Postgres-backed queue.
#
# Based on Playwright's own image: it carries Node, the Chromium build that
# playwright-core drives, and that build's system libraries, all pinned
# together. The tag must equal the playwright-core version in
# apps/worker/package.json (exact pin) — src/image.test.ts fails CI when the
# two drift, because a mismatched browser fails evidence capture at runtime,
# not at build time.
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble
FROM ${PLAYWRIGHT_IMAGE}

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
USER pwuser
ENV NODE_ENV=production HOME=/home/pwuser
WORKDIR /app/apps/worker

# Required at runtime: DATABASE_URL, ANTHROPIC_API_KEY, S3_* (evidence).
# Egress in production goes through the allowlist proxy (HTTPS_PROXY), which
# logs every fetched URL below the model — see apps/worker/README.md.
CMD ["node", "--import", "tsx", "src/index.ts"]
