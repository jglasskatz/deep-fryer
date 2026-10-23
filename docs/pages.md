# Public portrait releases

The public collection is deployed to https://jglasskatz.github.io/deep-fryer/ by the `CI` workflow. GitHub Settings → Pages must use **GitHub Actions** as its publishing source. The source repository is public. The host at microgridme.xyz is a separate deployment; this release does not change that domain's routing.

## Decision and boundaries

Pages hosts a portable, frozen public artifact. It has no account, database, model or billing credentials and does not run the Next.js server. The existing server application and its production/billing checks remain authoritative for those capabilities.

`site/catalog.json` is the explicit public export allowlist. The first release includes Santa Cruz city, Santa Cruz County, Watsonville, NYC and its five boroughs, Carmel-by-the-Sea city limits and Monterey County. The historical Santa Cruz views retain their source project’s context and varying vintages; NYC is read from existing published dimension versions. All indicators survive the export; a dimension's score must not be explained using only its first indicator.

Carmel and Monterey are **research previews**, explicitly requested for public display, not newly approved publications. Each has 24 findings, including 16 gaps. Independent source support is not human approval. Per-claim statuses distinguish source-supported drafts with exhibits from uncertainty and gaps. Missing numeric archives suppress the dimension's draft wedge. County proxies in Carmel say they are not city-limit measurements. The ordinary database research-verify gate still requires disposition of flags and a content-bound human approval before these findings can become published versions. This static preview grants neither.

This follows Keel's single source of truth, reproducible gate, evidence-at-access, numbers-with-epistemic-type, gap honesty and content-bound approval principles. The architecture map names this snapshot path separately from the application's public plane. The canonical renderer and score-to-display function are shared with the app.

## Data and evidence

- `site/data/portraits.json`: explicit snapshot, every indicator, geography, period, source, review note, cost scenarios and provenance.
- `site/data/evidence-manifest.json`: SHA-256 and byte length of every referenced archive.
- `site/evidence/shared/`: content-addressed, deduplicated screenshots and PDFs.
- `research/carmel-monterey-2026-10-18/`: source findings, reviews, configs and search/activity records for the research previews.

Snapshots contain no user accounts, memberships, session transcripts, private tenant listings or credentials. Exporting is read-only. The six NYC slugs are explicitly selected; the exporter never enumerates and publishes all tenants. Missing historical snapshots are disclosed and never fabricated. Source-producer hashes and version numbers make changes reviewable; they do not substitute for approval.

The research cost ledger is a sensitivity model, not billing telemetry. Actual agent token counts and billed dollars were unavailable. It records the assumed quantities and official price URLs, with Standard/Fast alternatives, and excludes app engineering and hosting. No cap was imposed for this research.

## Updating a release

Use the Node version in `.nvmrc` and pnpm 9.12.0:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm pages:snapshot --santa-cruz /path/to/doughnut-santa-cruz
pnpm pages:test
pnpm pages:build
pnpm pages:check
```

Only `pages:snapshot` needs `.env.local` with `DATABASE_URL`, the original Santa Cruz checkout and local mirrors of the referenced tenant evidence under `apps/web/public/evidence/`. Do not run database migrations against an old production database merely to export it. CI builds exclusively from the committed snapshot and evidence; it does not fetch sources or access a developer's database. For a new public portrait, change the catalog and provide its approved source. Never hand-edit a research preview into a published status.

Review changes to data, provenance, geography, archived files and statuses together. Open a PR. A schema-valid record can still be scientifically wrong: independent review and the application's publication gate remain necessary. Evidence hashes detect file drift, not truth.

## CI/CD

The existing `check` job runs fresh and idempotent database migrations, types, unit/Postgres/Stripe tests, production build and the Keel gate. Critical or unexpected gate errors block release; warnings are retained for review.

The `pages-build` job tests the exact catalog, indicator coverage, preview approval boundaries, scoring and paths. It verifies every referenced archive's hash and size, builds all static routes, then uses a browser at `/deep-fryer/` to check the entire collection, evidence links, labels, keyboard-reachable dimension links and mobile overflow. Local checks reuse installed Chromium. Only fresh CI runners install the locked Playwright browser. Screenshots and the release manifest are retained as workflow artifacts.

Both jobs must pass before `pages-deploy`. Pull requests run read-only checks and never deploy. Only `main` push/manual runs may deploy; only that deployment job has `pages:write` and `id-token:write`, under the `github-pages` environment. Actions are pinned to commit SHAs; Dependabot proposes reviewed updates. Dependencies install from the frozen lockfile. Set branch protection/rulesets to require `check` and `Public portrait contracts and browser checks` for future PRs; the workflow itself always enforces both before deployment.

The deployed artifact contains only `dist/pages`, never the repository root. `release.json` records the source commit, snapshot hash and included slugs. Source and exhibit URLs are visible in each portrait. A failed build leaves the previous deployment in place.

## Verify and roll back

After deployment, verify the home page, `/santa-cruz/`, `/nyc/`, `/carmel/`, `/monterey-county/`, an archived screenshot and `release.json`. Confirm the deployed commit is the expected release and that the preview labels survived.

To roll back, revert the release commit on `main` through a reviewed PR; CI rebuilds and redeploys the prior content. Avoid force-pushing history or bypassing failed checks. The **Run workflow** control can redeploy the checked current `main` snapshot without changing data. Re-run from the current revision when dependencies or evidence change; an old approval does not authorize modified findings.
