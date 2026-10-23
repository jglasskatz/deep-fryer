# Public portrait releases

The public collection is deployed to https://jglasskatz.github.io/deep-fryer/ by the `CI` workflow. GitHub Settings → Pages must use **GitHub Actions** as its publishing source. The source repository is public. The host at microgridme.xyz is a separate deployment; this release does not change that domain's routing.

## Decision and boundaries

Pages hosts a portable, frozen public artifact. It has no account, database, model or billing credentials and does not run the Next.js server. The existing server application and its production/billing checks remain authoritative for those capabilities.

`site/catalog.json` is the explicit public export allowlist. The first release includes Santa Cruz city, Santa Cruz County, Watsonville, NYC and its five boroughs, Carmel-by-the-Sea city limits and Monterey County. The historical Santa Cruz views retain their source project’s context and varying vintages; NYC is read from existing published dimension versions. All indicators survive the export; a dimension's score must not be explained using only its first indicator.

Regional selectors keep related portraits together at `/santa-cruz/`, `/nyc/` and `/carmel/`. Selection uses a shareable `?area=slug` query (for example `/carmel/?area=monterey-county`), supports browser back/reload, and preserves each portrait's original static route as a no-JavaScript fallback. Monterey continues to mean the researched county boundary, not the larger Monterey Bay region.

Hover summaries show each indicator's value, year, geography and evidence status. Selecting a segment opens its full evidence beside the chart, with a modal overlay on small screens, without scrolling the page. The `dim` query preserves the selected panel on reload. Keyboard links, Close and Escape provide the same controls; the full dimension list remains available without JavaScript.

Carmel and Monterey are **research previews**, explicitly requested for public display, not newly approved publications. Each has 24 findings. The latest Sol 6.1 medium-effort pass extends the earlier Luna research. The committed snapshot now has 20 numeric observations and 4 gaps for Carmel, and 19 numeric observations and 5 gaps for Monterey County. Carmel includes 12 city measures, 7 labeled county proxies and one California Current regional proxy. Each portrait includes one unscored heat observation; the two inherited housing findings remain uncertain. Per-indicator sources and geographic scope remain explicit. Dated and low-confidence estimates carry visible flags, and Census source periods remain explicit (city ACS 2020–2024 five-year; county ACS 2024 one-year). Independent source support is not human approval. Per-claim statuses distinguish source-supported scored drafts, supported unscored observations, uncertainty and gaps. The catalog explicitly selects `local-extreme-heat-v1` for these two previews: extreme heat replaces ozone, while the default framework and existing Santa Cruz/NYC portraits retain their original dimensions. CDC heat exposure is a 2018–2022 resident-weighted county observation, also shown as a county proxy for Carmel. No defensible safe annual-day target was established, so target, score and wedge level stay null. The details and hover summary say it is unscored; it cannot enter the server finding/approval pipeline as a scored finding. Missing numeric archives suppress the dimension's draft wedge. County proxies in Carmel say they are not city-limit measurements. The ordinary database research-verify gate still requires disposition of flags and a content-bound human approval before these findings can become published versions. This static preview grants neither.

This follows Keel's single source of truth, reproducible gate, evidence-at-access, numbers-with-epistemic-type, gap honesty and content-bound approval principles. The architecture map names this snapshot path separately from the application's public plane. The canonical renderer and score-to-display function are shared with the app.

## Data and evidence

- `site/data/portraits.json`: explicit snapshot, every indicator, geography, period, source, review note, cost scenarios and provenance.
- `site/data/evidence-manifest.json`: SHA-256 and byte length of every referenced archive.
- `site/evidence/shared/`: content-addressed, deduplicated screenshots and PDFs, including separate denominator exhibits for derived rates.
- `research/carmel-monterey-2026-10-18/`: original source findings, reviews, configs and search/activity records.
- `research/carmel-monterey-2026-10-23-expansion/`: the earlier Luna expansion, retained unchanged.
- `research/carmel-monterey-2026-10-23-sol-medium/`: Sol 6.1 medium research and independent review, raw inputs, portable derivations, per-dimension activity, and cumulative cost scenarios. Ozone work superseded by the user is archived and still counted in costs.
- `site/profiles/local-extreme-heat-v1.json`: the explicitly scoped dimension replacement, shared by export and validation and bound into the review manifest.

Raw research downloads, CSV tables and faithful source exhibits retain their original bytes through Git attributes; publisher encodings and line endings must not change under checkout. Portable derivations and recorded SHA-256 hashes provide the review path for these archives.

Snapshots contain no user accounts, memberships, session transcripts, private tenant listings or credentials. Exporting is read-only. The six NYC slugs are explicitly selected; the exporter never enumerates and publishes all tenants. Missing historical snapshots are disclosed and never fabricated. Source-producer hashes and version numbers make changes reviewable; they do not substitute for approval.

The research cost ledger is a sensitivity model, not billing telemetry. Actual agent token counts and billed dollars were unavailable. It records the assumed quantities and official price URLs, with Standard/Fast alternatives, and excludes app engineering and hosting. No cap was imposed for this research. Across all three rounds, the base sensitivity scenario totals $43.23 Standard or $82.59 Fast for both portraits together; this is modeled research cost, not measured spend. The latest round contributes $20.69 Standard or $39.89 Fast.

## Updating a release

Use the Node version in `.nvmrc` and pnpm 9.12.0:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm pages:snapshot --santa-cruz /path/to/doughnut-santa-cruz --campaign research/carmel-monterey-2026-10-23-sol-medium --require-review-manifest
pnpm pages:test
pnpm pages:build
pnpm pages:check
```

Only `pages:snapshot` needs `.env.local` with `DATABASE_URL`, the original Santa Cruz checkout and local mirrors of the referenced tenant evidence under `apps/web/public/evidence/`. Do not run database migrations against an old production database merely to export it. CI builds exclusively from the committed snapshot and evidence; it does not fetch sources or access a developer's database. For a new public portrait, change the catalog and provide its approved source. Never hand-edit a research preview into a published status.

The independent reviewer records hashes of the exact findings, reviews, supporting-source lists, every referenced archive and scoped framework profile in `review-manifest.json`. Export rejects changed or missing records when that manifest is present; `--require-review-manifest` also rejects its absence. CI also compares every displayed preview value and review note with those hash-bound files, binds each public exhibit to its full reviewed SHA-256, and recomputes canonical scores. This binds an independent review to its inputs and grants no human publication approval. `--output` can select a separate worktree's `site` directory while reading the original local evidence mirrors.

After all dimension and reviewer activity logs are final, run:

```sh
python3 research/carmel-monterey-2026-10-23-sol-medium/summarize-activity.py
node scripts/estimate-research-costs.mjs research/carmel-monterey-2026-10-23-expansion/cost-ledger.json research/carmel-monterey-2026-10-23-sol-medium
```

Shared research sessions are allocated across their portraits exactly once, including failed and superseded work. The estimator reads the recorded model and dated campaign prices, refuses unknown model prices, and preserves prior-round prices and totals. The CSV details the incremental round; JSON sums all rounds. Each round's token quantities are assumptions aggregated per role and portrait, not a measured per-agent bill; recorded web calls are only a search-charge proxy. Actual token usage and billing remain null. Medium effort is recorded without inventing a discount.

Review changes to data, provenance, geography, archived files and statuses together. Open a PR. A schema-valid record can still be scientifically wrong: independent review and the application's publication gate remain necessary. Evidence hashes detect file drift, not truth.

## CI/CD

The existing `check` job runs fresh and idempotent database migrations, types, unit/Postgres/Stripe tests, production build and the Keel gate. Critical or unexpected gate errors block release; warnings are retained for review.

A locked pnpm patch corrects Keel 0.2.0's filesystem-path detector: government HTTP URLs containing `/home/showpublisheddocument` are source addresses, not machine paths. The regression check proves that local paths on the same line, file URLs and malformed HTTP prefixes still fail. The remaining findings-without-approval warnings are expected for explicitly unapproved previews.

The `pages-build` job tests the exact catalog, indicator coverage, preview approval boundaries, canonical scoring, unscored-observation rules, review bindings and paths. It verifies every referenced archive's hash and size, builds all static routes, then uses a browser at `/deep-fryer/` to check the entire collection, evidence links, labels, keyboard-reachable dimension links and mobile overflow. Local checks reuse installed Chromium. Only fresh CI runners install the locked Playwright browser. Screenshots and the release manifest are retained as workflow artifacts.

Both jobs must pass before `pages-deploy`. Pull requests run read-only checks and never deploy. Only `main` push/manual runs may deploy; only that deployment job has `pages:write` and `id-token:write`, under the `github-pages` environment. Actions are pinned to commit SHAs; Dependabot proposes reviewed updates. Dependencies install from the frozen lockfile. The repository's `main` branch requires `check` and `Public portrait contracts and browser checks` with an up-to-date branch. Human PR review is not an added requirement. Configure the same protections when setting up a fork; the workflow itself always enforces both jobs before deployment.

Diagnostic and Pages artifacts include the workflow attempt number, so rerunning jobs preserves earlier evidence without colliding with it. The deployment consumes the successful build job's artifact-name output, including when only deployment is retried. A transient runner or download failure can be retried with **Re-run failed jobs**; the checks still gate deployment.

The deployed artifact contains only `dist/pages`, never the repository root. `release.json` records the source commit, snapshot hash and included slugs. Source and exhibit URLs are visible in each portrait. A failed build leaves the previous deployment in place.

## Verify and roll back

After deployment, verify the home page, `/santa-cruz/`, `/nyc/`, `/carmel/`, `/monterey-county/`, an archived screenshot and `release.json`. Confirm the deployed commit is the expected release and that the preview labels survived.

To roll back, revert the release commit on `main` through a reviewed PR; CI rebuilds and redeploys the prior content. Avoid force-pushing history or bypassing failed checks. The **Run workflow** control can redeploy the checked current `main` snapshot without changing data. Re-run from the current revision when dependencies or evidence change; an old approval does not authorize modified findings.
