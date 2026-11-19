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

**Archived web pages are published as source text, never as live pages.** GitHub Pages chooses a content type from the file extension and sends no CSP or nosniff header, and every Pages site of the owner shares the `jglasskatz.github.io` origin. An archived publisher page published under its own name would therefore run the publisher's scripts and analytics on that origin. So any archived or imported third-party file whose extension a browser renders or runs (`RENDERABLE_EXTENSIONS` in `site/published-name.js`: `.html`, `.htm`, `.shtml`, `.xhtml`, `.xht`, `.js`, `.mjs`, `.cjs`, `.svg`, `.svgz`, `.xml`, `.xsl`, `.xslt`, in any case) is published under its file name with `.txt` appended, which Pages serves as `text/plain`. The Argentina explorer's 28 archived HTML pages and 2 scripts open as `raw/<name>.html.txt` and `raw/<name>.js.txt`, labelled "Archived page source (text)" next to the link to the live original, and San Francisco's pinned `data.js` is published as `imports/san-francisco/data.js.txt`. The bytes are unchanged, so each recorded SHA-256 verifies against the published file, and the research builder checks this. PDFs, images, JSON, CSV and spreadsheets keep their names. `publishedArchiveName()` is the only place the published name is chosen: the builders and the link code all call it. After building, `assertNoLiveArchives()` in `scripts/pages-contract.mjs` fails the build, and `pages:check`, if any file under `research/`, `evidence/` or `imports/` has a renderable extension. The only exceptions are the pages and figures this project writes itself, listed in `FIRST_PARTY_RENDERABLE`. A new first-party page or figure must be added to that list in review. `site/evidence/` publishes only content-addressed PNG, JPEG and PDF exhibits (`publicAssetPath`).

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

## California report-checked import

The `/california/` route uses the shared canvas, dimension explorer, responsive evidence panel and source links. It contains 21 dimensions and all 42 indicators from the ca-doughnut snapshot at `6ff5033d020291985e47548509dc0ee1d2547488`, reconciled against the November 2025 California Doughnut Report. This is a report-transcription check, not independent validation of the underlying studies, publication approval, a live database migration or a deployment.

`site/imports/california/` preserves the original `doughnut.json`, `raw_social.csv` and `raw_ecological.csv` byte-for-byte. `report-audit.json` is a separate hash-bound overlay with all 42 report observations, targets, units, measured periods, scores, comparisons and caveats. Its source is the 95-page report at https://zenodo.org/records/17540639. The downloaded PDF matched the Zenodo MD5 `fa91f14fe71eeae586cdc1d6d12616b0`. Pages 84 and 85 were text-extracted and visually inspected. Content-addressed PNGs and a two-page PDF excerpt are retained in `site/evidence/california-report/` and checked by the evidence manifest. The official report's linked live workbook was also inspected, but does not silently replace the dated PDF.

Of 42 scores, 37 exactly match the report, one is a rounding difference (sanitation: imported 0.57%, report 0.6%), and four source outcomes were omitted or replaced by category-average fallbacks in the old import:

- Protected Area: report overshoot 59%, not the inherited biodiversity category mean of 503%.
- At-Risk Species: report overshoot 947%, not missing.
- Ozone-Depleting Substances and Ozone Layer: both explicitly `No Overshoot`. Their display scores are zero and their wedge is green. This is report evidence, not a missing-to-zero conversion.

Seven native social observations omitted by the imported CSV are restored from page 84: food insecurity 11.4%, vegetables/day 59.2%, homelessness 0.47%, poverty 15.4%, unemployment U6 9.3%, water quality 2.2%, and sanitation 0.6%. All 42 native targets and unit meanings align. Life expectancy and toxic-chemical observations have report/workbook rounding differences. The poverty measured period is 2021–2023 rather than the old top-level 2021. Forest Cover is 2022 in the PDF, while the live workbook marks `2022? / 2024`; that uncertainty is visible. Publication-year uncertainties remain in the archived import.

The primary display follows the report's precision. Headlines are labeled `Report shortfall` or `Report overshoot`, separate from native observations and targets. Native GHG is 19.6 tonnes CO2 eq per capita (consumption), with 1890% overshoot against 0.985. Homelessness 35.9% is a normalized shortfall, not population prevalence; page 37 explains the 187,084 people / 0.47% observation and 1.32% OECD comparator. Original import values, periods, scores, underlying links and category fallbacks remain separately labeled provenance. Top-level score targets stay null.

Wedges use the mean of the two report percentages mapped through `pctToVizLevel`, capped at 150. These mixed constructs are not additive or a validated composite ranking. Biodiversity is scored red. Ozone has a green label marker with zero external bar height, so its safe status is visible without inventing a negative overshoot. Neutral dark grey remains available for genuinely unscored observations elsewhere, pale grey for data gaps, and blue for selection. Selecting a scored wedge temporarily shows blue without changing its score.

The inconsistent old example `data/california.csv` remains excluded. Some example figures happened to match the final report (including at-risk species 947%), but it also contained substantive discrepancies. All corrections now cite the actual report, not that example.

`scripts/california-import.mjs` rebuilds deterministically from hash-pinned originals plus the report audit. All 11 pre-import portraits and the large tracked baseline snapshot remain unchanged. The complete portrait download (13 portraits, with San Francisco) is generated into `dist/pages/data/portraits.json`. The equality gate rejects changed values, scores and forged approvals. `approved: false` remains explicit. Contacts and outreach drafts are not included.

Run `pnpm pages:test`, `pnpm pages:build` and `pnpm pages:check`. Tests cover all 42 report scores, immutable original records, native units and targets, omitted values, rounding, explicit no-overshoot, measured ranges, source hashes and tampering. Browser checks cover desktop/mobile, archive downloads, keyboard selection, repeated selection, reload, Close/Escape and no-JavaScript access. Browser checks require an executable installed Chromium; inability to launch is not a passing UI result.

## San Francisco community import

The `/san-francisco/` route shows the City of San Francisco portrait from a community fork of the Santa Cruz doughnut project, [`BioKyle/doughnut-san-francisco-v1`](https://github.com/BioKyle/doughnut-san-francisco-v1), pinned at commit `5cce9f1cc476052b88c316d847926e0ad34b4b00`. Its 21 dimensions use the shared canvas, dimension explorer and evidence panel. Nothing in it has been researched, checked against its sources or approved here, and the page says so in a notice that is open by default, with links to the original data file, the import record and the pinned commit.

`site/imports/san-francisco/data.js` is the fork's `docs/data.js`, kept byte-for-byte (79,628 bytes, sha256 `2a18eca99b39838bbe054b80c106d9032eb289056d3f25b6e34e15ada020f531`; `.gitattributes` keeps its line endings). The build never runs it: `scripts/legacy-data-literal.mjs` parses it with the TypeScript parser and accepts only a single `JURISDICTIONS` object literal made of strings, numbers, booleans, null, arrays and plain objects. A function call, template expression, getter, method, spread, computed or repeated key, or a second statement is refused. `site/imports/san-francisco/manifest.json` is the import record: the pin, `approved: false`, a decision for every jurisdiction in the file, and the known issues. `scripts/san-francisco-import.mjs` assembles the portrait at build time, like California, so the frozen research snapshot is unchanged; `scripts/portrait-imports.mjs` lists both imports.

**Scores are the fork's.** By the owner's decision every dimension keeps the fork's own `level`, unchanged, with no score withheld and no per-row flag. Ocean acidification, chemical pollution and ozone layer depletion therefore draw as within target, and freshwater withdrawals as an overshoot of 42. The chart explanation says only that wedges show the scores the source project assigned.

**SoMa is not included.** The fork also contains a SoMa portrait, but all 22 of its rows are identical to the Watsonville portrait in the frozen baseline (the fork started from the same Santa Cruz commit); only its name, population and description were changed. A test checks that this still holds (22 of 22 rows). The fork's City of Santa Cruz and Santa Cruz County entries are inherited from the upstream project, which the collection already includes.

**Known issues.** The import record lists these for the fork's author. They are recorded, not shown on the page, and the importer re-checks the facts behind each one against the pinned file, so the list fails the build rather than going stale:

1. Ocean acidification, chemical pollution and ozone layer depletion repeat one placeholder record ("Regional environmental baseline", "Compliant with state limits", source "EPA / NOAA Region 9") rather than a measurement each.
2. Freshwater withdrawals reports 42 gallons per person per day against a target of 45, which is within target, yet carries an overshoot level of 42.
3. Peace & justice names its source as "Projected Synthesis".
4. Source links go to publishers' home or section pages, not to the cited documents.

The build fails if the file's bytes or hash, the pinned commit or the list of jurisdictions changes, if the record is marked approved or brings back withheld scores or flags, or if a known issue no longer matches the file. The release equality gate rejects any edit to the published portrait, including a changed score and a forged approval.

**Refreshing the pin when the fork changes.**

1. Download `docs/data.js` at the new commit (`https://raw.githubusercontent.com/BioKyle/doughnut-san-francisco-v1/<commit>/docs/data.js`) over `site/imports/san-francisco/data.js`. Do not open it in a browser or run it.
2. Record its `sha256` and byte count in `manifest.json` (`files["data.js"]`), and the new `commit` and `imported_at`. Change the matching `pinned` values in `scripts/san-francisco-import.mjs` and the expected commit, hash and size in `scripts/san-francisco-import.test.mjs` and `scripts/check-san-francisco-ui.mjs`. The pin is deliberately written in more than one place, so a changed file cannot slip in through the record alone.
3. Run `pnpm pages:test`. A new jurisdiction needs its own decision in the record. If SoMa no longer matches Watsonville, decide whether to import it rather than editing the test to pass. If the author has fixed a known issue, the importer reports it: remove that issue from the record and from the importer's list. A new placeholder group or score contradiction must be added to the list.
4. Run `pnpm pages:build` and `pnpm pages:check` and read the built `dist/pages/san-francisco/index.html`.

Run `pnpm pages:test`, `pnpm pages:build` and `pnpm pages:check`. Tests cover the pin, all 21 values, targets, years, sources, links, actions and scores against the fork's record, the known issues, the SoMa exclusion, the literal-only reader and tampering. The browser check covers the collection card, the open notice and its three links, each dimension's state against the fork's level, the panel and deep link, 390px and no-JavaScript reading.

## NYC and Santa Cruz policy evidence study (draft)

`site/policy-view/` is an additive, portable retrospective evidence atlas, copied
to `/policies/` by the static builder. Its policy outcomes retain native units,
periods, jurisdictions and causal limitations. Conceptual Doughnut slice links
are not new portrait scores and do not update `site/data/portraits.json`. The staff analyzer offers the existing modeled portrait comparison plus explicit retrospective and prospective evidence-graph modes. Graph modes do not resize portrait wedges or assert custom-dimension mappings. Source-text matches are not claim validation. City, county, water-service and regional outcomes must remain distinct.

The artifact is a research draft, not a publication approval. Keel architecture
and principle checks are code checks, not independent verification of every
statistical claim. Missing source archives or unresolved claims remain explicit.
No database approval, paid research call or deployment is needed to review the
local artifact. Run `node --test scripts/policy-study.test.mjs` for its structural
checks, in addition to the normal Pages and Keel checks above.

