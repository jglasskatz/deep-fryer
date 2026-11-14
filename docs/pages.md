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

## California legacy import

The `/california/` route uses the same canvas, dimension explorer, responsive evidence panel and source links as the other Deep Fryer portraits. It contains 21 dimensions and all 42 indicators from the shipped ca-doughnut snapshot at commit `6ff5033d020291985e47548509dc0ee1d2547488`. This is an explicitly unverified legacy import, not new scientific verification, human publication approval, a live database migration or a deployment.

`site/imports/california/` preserves the original static `doughnut.json`, `raw_social.csv` and `raw_ecological.csv` byte-for-byte. The manifest records source paths, hashes and commit. The old example `data/california.csv` is excluded: it contains substantial discrepancies, including homelessness 55% versus the shipped snapshot's 35.9%, forest cover 351% versus 28%, and a misleading 947% at-risk-species entry instead of the shipped snapshot's absent overshoot. These are not silently reconciled or described as verified observations.

The exact original records are retained in the public download. Headline shortfalls/overshoots and native worksheet measurements are labeled separately. For example, GHG shows 1890% imported overshoot and a native measurement of 19.6 tonnes CO2 eq against 0.985. Protected Area's inherited 503% and Ozone-Depleting Substances' inherited 0% originate in category-average cells, not individual overshoot cells; both are prominently flagged and displayed separately from native values. At-Risk Species and Ozone Layer have observations but missing overshoot scores; neither becomes zero. Global ozone thickness retains its global label and Dobson units. Homelessness's 35.9% is a reported shortfall, not a percentage of California residents or a point-in-time count.

Full measured/published strings, including `2021-2023 / 2024` and uncertain dates, remain visible. Data span 2005–2025. The source percentages mix constructs and are not additive or a validated composite ranking. The source's mean is used only when both percentages are supplied, then mapped through the shared `pctToVizLevel` display function. Incomplete pairs remain unscored. This avoids the legacy renderer's positive-shortfall-as-safe display behavior; large wedges saturate while exact percentages remain available.

`scripts/california-import.mjs` rebuilds deterministically from hash-pinned sources. `pages:build` assembles the import after reconstructing the content-bound existing research release; all 11 original portraits remain unchanged. The large tracked baseline snapshot stays byte-for-byte unchanged. The complete 12-portrait download is generated into dist/pages/data/portraits.json, not committed. `pages:amend` and `pages:snapshot` retain the existing baseline workflow. The equality gate still rejects missing/altered values, scores and approvals. Only explicit source files are copied to the public artifact. Contacts and outreach drafts are not migrated as indicator data.

Run `pnpm pages:test`, `pnpm pages:build` and `pnpm pages:check`. California regressions cover parity, native-unit separation, null/zero, inherited fallback values, date strings, tampering, desktop/mobile and repeated/interrupted detail-panel flows. Browser evidence must be checked against the current reconstructed revision; earlier results are not acceptance of a new commit.

Category-average fallback percentages remain available only as source provenance. They are explicitly labeled “not indicator overshoot,” and the corresponding individual score stays unknown. No replacement report-edition figures are substituted without verification.

Original measurement definitions belong beside the native worksheet observation and target, not beside the imported score as its definition. For example, Gender Pay Gap retains 12.9% imported shortfall and 87.1% native wages earned against 100%; Voter Turnout retains 40.0% shortfall and 60.0% native turnout against 100%. The same separation applies to every imported indicator, including inverse scales and non-percentage observations. Compact dimension summaries identify their values as imported shortfall/overshoot or unknown-score source values. Top-level score targets remain null; exact original targets remain in `source_worksheet` and `legacy_record`. Blank worksheet values, such as Vegetables per Day, remain “Not supplied” rather than being inferred from a shortfall. These changes clarify labels, not the reported values or their unverified status.

The shared Pages presentation uses neutral dark grey for available-but-unscored dimensions, replacing the previous purple/slate override. California's Biodiversity Loss and Ozone Depletion remain unscored; the palette does not fill missing values or imply a safe result. The original red/green scoring palette, pale-grey data gaps and blue selection state are unchanged. The legend and dimension labels explicitly distinguish unknown scores from absent data.
