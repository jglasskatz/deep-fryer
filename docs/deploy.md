# Deploying deep-fryer

This is a pnpm-workspace monorepo. The deployable surface is `apps/web` (the Next.js app). `packages/db`, `packages/core`, and `packages/mcp` are workspace dependencies — they ship as TS source and Next compiles them via `transpilePackages`.

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

## Custom domain (later)

When you buy `deep-fryer.io` (or whichever):

1. Vercel project → **Settings → Domains → Add**
2. Add `app.deep-fryer.io` (apex/`www` come later if needed)
3. Add the CNAME/A records Vercel shows you to your DNS provider
4. SSL is automatic

## Local development

See [`local-setup.md`](./local-setup.md).
