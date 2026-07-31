# Deploying deep-fryer

This is a pnpm-workspace monorepo with two deployable surfaces (SPEC §4):

- `apps/web` — the Next.js app (public + review planes) → **Vercel**
- `apps/worker` — the research plane → **Fly.io/Railway** (long-running agent
  sessions can't live on Vercel; the web app enqueues, the worker executes)

Workspace packages ship as TS source; Next compiles them via `transpilePackages`.

## Vercel (production)

1. Go to https://vercel.com → **Add New… → Project**
2. Import `jglasskatz/deep-fryer` (private repo — make sure your Vercel account is connected to the right GitHub)
3. **Configure project:**
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `apps/web`
   - Click **Edit** next to Root Directory and toggle on **"Include source files outside of the Root Directory"** — this is required so the install picks up `pnpm-workspace.yaml` + `pnpm-lock.yaml` + the workspace packages
   - **Install Command** (override): `cd ../.. && pnpm install --frozen-lockfile`
   - **Build Command:** leave default (`next build`)
   - **Output Directory:** leave default (`.next`)
4. **Environment Variables** — leave empty for the first deploy. The viewer renders mock data without any env. Add Supabase/Anthropic keys later when those services are provisioned.
5. Click **Deploy.** First build takes ~2 minutes.

## Verifying the deploy

The deployed URL (`deep-fryer-<hash>.vercel.app`) should serve:

- `/` — landing page
- `/santacruz` — the mock Santa Cruz doughnut chart (interactive, with tooltip + click-to-select)
- `/santacruz/admin` — admin placeholder
- `/embed/santacruz` — embed placeholder

If `/santacruz` renders the chart and the tooltip works, the deploy is healthy.

## Worker (Fly.io / Railway)

Build from `apps/worker/Dockerfile` (repo root as build context). Required env:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Production isolation and the egress allowlist proxy are documented in
[`apps/worker/README.md`](../apps/worker/README.md). Run migrations before the
first deploy: `DATABASE_URL=... pnpm --filter @deep-fryer/db db:migrate`.

## Supabase

Create a project, enable the Google OAuth provider, and set the env vars from
`.env.example` in both Vercel and the worker. Storage buckets
(`tenant-<slug>`) are created automatically at first evidence upload or by
`import-santa-cruz`.

## Custom domain (later)

When you buy `deep-fryer.io` (or whichever):

1. Vercel project → **Settings → Domains → Add**
2. Add `app.deep-fryer.io` (apex/`www` come later if needed)
3. Add the CNAME/A records Vercel shows you to your DNS provider
4. SSL is automatic

## Local development

See [`local-setup.md`](./local-setup.md).
