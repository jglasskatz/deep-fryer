# California portrait import

## Scope and provenance

Add the existing California dataset to Deep Fryer's static portrait UI on an isolated review branch. This is not new research, independent verification, human publication approval, a live database migration, a main merge, or deployment. PR #18's policy-evaluator work is outside this migration.

Source: https://github.com/jglasskatz/ca-doughnut/tree/6ff5033d020291985e47548509dc0ee1d2547488

The three imported files are preserved byte-for-byte under `site/imports/california/`; `manifest.json` records their original paths, SHA-256 hashes and sizes. The original static `frontend/public/api/regions/california/doughnut.json` is the display snapshot. The two raw CalDEC worksheets preserve native observations, original dates and metadata. All 21 categories and 42 indicators are retained, including original records, URLs, targets, nulls and explicit zero. The legacy source status and `approved: false` remain explicit.

Do not use the repository's older `data/california.csv` example: it has no source URLs and differs in 22 of 32 exact-name matched percentages. Contacts and outreach drafts are outside indicator scope. Empty source category metadata must not be filled from that inconsistent example.

## Interpretation safeguards

- A displayed shortfall or overshoot is not a native measurement. GHG is 1890% imported overshoot, while the worksheet measurement is 19.6 tonnes CO2 eq against 0.985. Native units must never be appended to percentage scores.
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
