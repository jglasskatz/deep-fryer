# Web app (public + review planes), self-hosted (SPEC §4).
# Build from the repo root: docker build -f apps/web/Dockerfile .
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS builder
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# The research package reads the vendored plugin at runtime (plan rendering).
COPY vendor ./vendor

RUN pnpm install --frozen-lockfile --filter @deep-fryer/web...

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN pnpm --filter @deep-fryer/web build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/vendor ./vendor
ENV OPEN_DOUGHNUT_PLUGIN_DIR=/app/vendor/open-doughnut/plugin

# Required at runtime: DATABASE_URL; Supabase env for auth/storage;
# NEXT_PUBLIC_* vars must be present at BUILD time to be inlined for the
# client (pass as --build-arg or bake per-environment images).
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
