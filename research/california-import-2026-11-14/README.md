# California portrait import

## Current report audit (2026-11-15)

The initial legacy-import notes below are historical. The display now uses a separate report-backed overlay, while the three source files remain byte-for-byte intact. See `docs/pages.md` (California report-checked import) and the full 42-indicator `site/imports/california/report-audit.json`. The authoritative PDF was downloaded from Zenodo, matched against its published MD5, and pages 84–85 were visually checked. Four ecological results and seven native values missing from the old import are restored. Ozone is explicitly within-boundary and green, biodiversity is scored overshoot. All 42 targets and unit meanings align. The PDF/source rounding differences and Forest Cover year uncertainty remain documented. Underlying studies were not independently re-audited and publication approval remains false.

## Historical import record

## Scope and provenance

Add the existing California dataset to Deep Fryer's static portrait UI on an isolated review branch. This is not new research, independent verification, human publication approval, a live database migration, a main merge, or deployment. PR #18's policy-evaluator work is outside this migration.

Source: https://github.com/jglasskatz/ca-doughnut/tree/6ff5033d020291985e47548509dc0ee1d2547488

The three imported files are preserved byte-for-byte under `site/imports/california/`; `manifest.json` records their original paths, SHA-256 hashes and sizes. The original static `frontend/public/api/regions/california/doughnut.json` is the display snapshot. The two raw CalDEC worksheets preserve native observations, original dates and metadata. All 21 categories and 42 indicators are retained, including original records, URLs, targets, nulls and explicit zero. The legacy source status and `approved: false` remain explicit.

Do not use the repository's older `data/california.csv` example: it has no source URLs and differs in 22 of 32 exact-name matched percentages. Contacts and outreach drafts are outside indicator scope. Empty source category metadata must not be filled from that inconsistent example.

## Interpretation safeguards

- A displayed shortfall or overshoot is not a native measurement. GHG is 1890% imported overshoot, while the worksheet measurement is 19.6 tonnes CO2 eq against 0.985. Native units must never be appended to percentage scores.
- Native definitions and targets must accompany the worksheet observation, not define the headline percentage. Gender Pay Gap is 12.9% imported shortfall versus 87.1% native wages earned (target 100%); Voter Turnout is 40.0% shortfall versus 60.0% native turnout (target 100%). Preserve this separation for all 42 indicators. Compact summaries identify their value type. Top-level targets are null while original targets survive unchanged in the native worksheet and legacy records. Do not infer absent native values, including Vegetables per Day, from shortfalls.
- Protected Area's inherited 503% and Ozone-Depleting Substances' inherited 0% came from the source category `Average` column, not supplied indicator overshoots. Their original values (25.2% / 16.2%, and Yes) are labeled source values; the inherited category average appears separately and is explicitly not an indicator overshoot. Both individual scores remain unknown.
- At-Risk Species and Ozone Layer have observations but missing overshoot percentages. Null is not zero. Ozone Layer is a global observation and retains Dobson Units.
- Homelessness's 35.9% is the imported shortfall score, not the percentage of Californians experiencing homelessness. Its worksheet native count is missing.
- Full measured/published dates retain ranges and uncertainty: Poverty `2021-2023 / 2024`, Literacy `2017 / 2018?`, Housing Cost Burden `2018 / 2020?`. Source periods span 2005–2025.
- Complete percentage pairs use their arithmetic mean mapped through Deep Fryer's display scale. Incomplete pairs remain unscored. These mixed constructs are not additive or a validated composite ranking, and scale saturation does not change stored percentages.
- The existing 11 portraits must remain exact. Their canonical JSON array SHA-256 before adding California is `3d5dbeb155e104a8724483dc92b1065faf24faf175490fa604cc9339e421af63` (main `c7798c74`). Content-bound release validation must continue rejecting altered values and forged approval.

## Reconstruction and verification status

A durable source checkpoint was published at `6fd4b9c4c82d2ae00a2002ed9d380bcb2dfc74d5` on `codex/import-california-2026-11-14`. Implementation and tests were reconstructed after workspace loss. Historical results do not establish acceptance of reconstructed code.

**Current reconstruction:** all 30 Pages tests passed, including exact preservation of the 11 pre-import portraits; the production static build passed with 12 portraits and 240 checked evidence files; architecture-map validation passed. Workspace typecheck passed and workspace tests passed (893 passed, 257 service-dependent skips). A real compiled California Climate Change view was captured and reviewed: 1890% overshoot and 19.6 tonnes CO2 eq native measurement remain separate, and Close/reselect passed. Full automated browser/mobile coverage remains unrun in this executor; final remote-commit verification is recorded separately. No paid-provider calls, CI reruns, merge or deployment are part of these checks.

`scripts/california-import.test.mjs` covers exact source/worksheet parity, all 42 records, preservation of the existing 11 portraits, unapproved provenance, tamper rejection, missing versus zero, fallback origins, units, full periods and exclusion of the old example.

`scripts/check-california-ui.mjs` checks the built `dist/pages` artifact offline using an already installed Chromium. It covers desktop and 390/320px layouts, scoped fallback score/native-value assertions, keyboard/repeated selection, reload, Close/Escape, source downloads and no-JavaScript access. Indicator assertions target headings rather than relying on original record order. It writes screenshots to `test-results/california/`. Run only after rebuilding the current code. Source requests outside the local test origin are blocked.

The complete release is assembled at build time by publicRelease() and checked against the content-bound reconstruction. The large tracked 11-portrait baseline remains unchanged; generated dist/pages/data/portraits.json contains all 12 portraits.

## Definition and palette follow-up

The generic definition previously passed through a native measurement description next to an imported score. Definitions now appear inside the native worksheet section with the observation and target. Top-level targets are null; raw files, original records, source percentages and dimension levels are unchanged. Tests explicitly cover the pay ratio, voter turnout, other inverse scales and absent native observations.

Available-but-unscored wedges now use neutral dark grey instead of the previous purple/slate override. Matching legend and control styles changed with it. Red/green scores, pale-grey data gaps and blue selection remain unchanged, including the unknown scores for California biodiversity and ozone.

Local verification for this follow-up: 32 Pages tests, the production static build, workspace typecheck (also the workspace lint command's check), architecture-map validation and built-HTML assertions passed. The broad workspace regression did not finish and is not claimed as passed. Full automated browser/mobile coverage remains unrun; manual visual checks are recorded separately. No CI rerun, merge or deployment is included.

## Report-audit verification

On 2026-11-15, the final report overlay passed all 34 Pages tests, the production static build (12 portraits; 243 checked evidence assets), all seven workspace TypeScript checks, and the architecture-map check. The five library-package test suites completed with 259 passing tests and 27 service-dependent skips. A full workspace regression did not finish: an external API request from the web test suite was denied; the remaining web/worker suites are not claimed as passed. The focused shared-renderer suite passed all 6 tests.

Automated browser checks could not launch the installed Chromium because its socket operation returned EPERM, including after the permitted retry. The browser assertions were therefore not run in that process. Screenshots and manual browser coverage must be checked separately against this rebuilt artifact. These local checks do not establish remote CI, merge or deployment.

Manual visual review of the rebuilt managed-browser preview passed: the unselected Ozone Depletion label is green, Biodiversity Loss is red, and selected ozone remains blue with a Within target / No overshoot panel. Both ozone cards retain their native observations (284 Dobson Units against >276, measured 2020; and Yes against Yes). Overview and selected-ozone screenshots were captured from this build. This manual check does not replace the unrun full automated desktop/mobile regression.
