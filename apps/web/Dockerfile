# Web app (public + review planes), self-hosted (SPEC-v3 §2.4).
# Build from the repo root: docker build -f apps/web/Dockerfile .
# One image serves any deployment: every setting is runtime env (no
# NEXT_PUBLIC_* build args).
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS builder
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# The research package reads the vendored plugin at runtime (plan rendering).
COPY vendor ./vendor

RUN pnpm install --frozen-lockfile --filter @deep-fryer/web...
RUN pnpm --filter @deep-fryer/web build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    OPEN_DOUGHNUT_PLUGIN_DIR=/app/vendor/open-doughnut/plugin

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/vendor ./vendor

USER node
EXPOSE 3000
# Required at runtime (the server refuses to start otherwise — see
# apps/web/lib/env.ts): DATABASE_URL, AUTH_SECRET, APP_URL, and at least one
# sign-in method. Optional: STRIPE_*, SMTP_URL/EMAIL_FROM, S3_PUBLIC_URL.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
