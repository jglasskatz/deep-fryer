# Research-plane worker (SPEC.md §4): runs as its own DigitalOcean container
# (App Platform worker or droplet compose service), decoupled from the web
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

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# The vendored plugin IS the research runtime (SPEC.md §5); CI pins its version.
COPY vendor ./vendor
ENV OPEN_DOUGHNUT_PLUGIN_DIR=/app/vendor/open-doughnut/plugin

RUN pnpm install --frozen-lockfile --filter @deep-fryer/worker...

# Required at runtime: DATABASE_URL, ANTHROPIC_API_KEY,
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (evidence storage).
# Egress in production goes through the allowlist proxy (HTTPS_PROXY), which
# logs every fetched URL below the model — see apps/worker/README.md.
CMD ["pnpm", "--filter", "@deep-fryer/worker", "start"]
