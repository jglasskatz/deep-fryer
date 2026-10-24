All-portrait research campaign — GPT-6.1 Sol, high effort

All 11 portraits were inventoried. Batch 1 contains 34 proposed amendments across 9 portraits; a separate housing supplement adds 2 observations for Carmel and Monterey County. No research finding has independent review or human approval merely because it is present here. Root owns integration and GitHub operations.

Review entry points:
findings/amendments.json — frozen 34-claim before/after batch.
findings/supplemental-housing.json — 2 direct primary Census supplements.
findings/gap-dispositions.json — 9 retained explicit Carmel/Monterey gaps.
inventory-dispositions.json — all 11 portraits, including remaining work.
evidence-manifest.json — frozen 41-file batch binding.
supplemental-evidence-manifest.json — separate supplemental binding.
activity/summary.json and searches/web-queries.json — new activity only.
cost-sensitivity.json and .csv — assumptions, not measured usage or invoices.

Reproduction:
Run derive.py, then polish.py, render-jobs.json through run-jobs.py, then finalize.py. This reproduces semantic findings; new browser renders change evidence timestamps and potentially bytes, requiring a new independent review. Do not rerun over a frozen reviewed batch as a routine check. Supplement extraction is in supplement-housing.py. Large official national DAT files are compressed losslessly; source SHA-256 refers to decompressed publisher bytes, and a separate stored hash binds the gzip file. Original campaigns remain unchanged.

Scientific priorities:
NYC water: annual State newly-entered violations and a historical federal treatment-technique record use different compliance constructs. Proposed uncertainty is not proof that either old endpoint value was categorically false.
Bronx waste: January omission exactly reproduces both prior incorrect totals. DSNY refuse collection remains a disposal proxy, not a measured final-landfill series.
NYC conservation: the cited 19.5% includes land AND water, so the related observation is unscored.
TRI: Form A quantities are unknown, not measured zeros. Form R totals and population vintages are explicit.
Santa Cruz city PIT: published total 1,024 conflicts with components 789 + 234 = 1,023. Retain uncertainty. County 1,648 and Watsonville 303 are consistent.
Heat: county population-weighted 2018–2022 exposure, not city-limit observations; target and score stay null. Integrating it for the Santa Cruz trio requires an explicit local-extreme-heat-v1 profile.
Census: city 2020–2024 five-year and county 2024 one-year periods differ. No combined-ratio MOE is fabricated. At-least-30% rent burden cannot identify a strict over-30% point estimate; bounds and an unscored related observation are supplied.

Remaining work is explicit: many legacy Santa Cruz narratives lack compliant numerical definitions or source exhibits; household median energy burden, groundwater representativeness, annual water-service allocation and recent whole-county GHG gaps remain. Retained gaps were audited; this round does not claim a new exhaustive search for every gap. Watsonville's water report is readable through the web reader, but direct PDF archival repeatedly failed; the potentially misleading legacy nitrate characterization remains a documented candidate rather than a fabricated accepted replacement.

Integrated review outcome:
reviews/independent-sol-high.json accepted31 and requested5 revisions. The initial reviewer authored those5 corrections in findings/reviewer-suggested-corrections.json. A different Sol6.1 high agent accepted all5 in reviews/corrections-independent-sol-high.json. site/research-overlays.json binds these exact reviews and their upstream payloads; the public snapshot applies31originals+5corrected supersessions. Human approval remains false. The cost-ledger.json/.csv count researcher, initial reviewer/corrective author and separate correction reviewer once each; build-cost-ledger.mjs reproduces the assumptions without inventing measured usage.
