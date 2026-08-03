# Deploying deep-fryer

Two dockerized services (SPEC §4), deployed to DigitalOcean:

- **web** — the Next.js app (public + review planes), `apps/web/Dockerfile`
- **worker** — the research plane, `apps/worker/Dockerfile`

Both talk to **Supabase** (Postgres + Auth + Storage) over HTTPS — Supabase is
host-agnostic, so nothing changes about auth, RLS, or storage when self-hosting
the app. `docker-compose.yml` at the repo root wires both services (plus an
optional local Postgres under the `local` profile).

## Supabase (once)

1. Create a project at supabase.com; enable the **Google** OAuth provider
   (Auth → Providers) and add your domain to the redirect allowlist.
2. Run migrations against its Postgres:
   `DATABASE_URL=<supabase connection string> pnpm --filter @deep-fryer/db db:migrate`
   (use the *session* pooler connection string or the direct connection —
   graphile-worker in the worker needs a direct/session connection, not the
   transaction pooler).
3. Collect the env values from Project Settings → API: URL, anon key, service
   role key.

## Option A — DigitalOcean App Platform (managed)

1. **Create App** → GitHub → `jglasskatz/deep-fryer`.
2. Add two components from the same repo:
   - **Web Service**: Dockerfile path `apps/web/Dockerfile`, HTTP port 3000.
     Set build args `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_APP_URL` (these are inlined into the client bundle at build
     time) and runtime env `DATABASE_URL`, `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`.
   - **Worker** (no HTTP route): Dockerfile path `apps/worker/Dockerfile`,
     runtime env `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_CONCURRENCY=1`.
3. Mark all keys as **encrypted** env vars. TLS and the domain are managed by
   the platform (add `app.deep-fryer.io` under Settings → Domains).

## Option B — Droplet with docker compose (cheapest, most control)

```bash
# On a Docker droplet (2 GB is fine to start; the worker's Chromium likes RAM):
git clone git@github.com:jglasskatz/deep-fryer.git && cd deep-fryer
cat > .env <<EOF
DATABASE_URL=...supabase connection string...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_APP_URL=https://app.deep-fryer.io
ANTHROPIC_API_KEY=...
EOF
docker compose up -d --build web worker
```

Put TLS in front with a DO Load Balancer (managed certs) or Caddy/nginx on the
droplet. Scale research throughput by running more worker containers
(`docker compose up -d --scale worker=3`) — sessions are independent and the
queue is in Postgres.

## Fully local stack (no Supabase)

```bash
docker compose --profile local up -d --build
DATABASE_URL=postgres://postgres:postgres@localhost:54322/deep_fryer \
  pnpm --filter @deep-fryer/db db:migrate
```

Auth runs in labeled dev mode and evidence lands on local disk — fine for
development, not for production.

## Verifying a deploy

- `/` — landing page; `/santacruz` — the doughnut (after an import or publish)
- `/santacruz/admin` — admin (Google sign-in via Supabase)
- `/embed/santacruz` — embed view
- Worker logs show `deep-fryer worker: listening for research jobs`

## Custom domain

Point `app.deep-fryer.io` at the App Platform app (Settings → Domains) or at
the droplet/load balancer IP; certificates are automatic on App Platform and
with a DO Load Balancer.

## Local development

See [`local-setup.md`](./local-setup.md).
