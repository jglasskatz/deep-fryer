**Independent Sol high research review**

Reviewed 36 frozen amendments: 31 accepted for research preview, five require revision, none rejected. Audited nine retained gaps. This is an independent machine review; it grants no human approval, publication approval, database change or GitHub action.

Every baseline payload and all 70 source-support entries match their bound bytes. The pass covers 28 unique raw sources, 16 visually inspected exhibits and 45 evidence-manifest entries. The independent check script completed 334 checks: 332 passed and two exposed evidence defects.

**Five revisions required in the initial batch**

- NYC waste: remove or clarify the final sentence that juxtaposes Bronx with the NYC fiscal-year reduction of 12.55%. Bronx calendar-year reduction is 6.44%.
- NYC conservation: the exhibit prints 19.52273360% for 43,374 / 222,182 × 100. Correct result: 19.52183345%, still 19.5% when rounded.
- Santa Cruz County broadband: the primary GCT2801 CSV supports 94.9% ±1.1, but the cited exhibit lacks that row and instead contains a different five-year county table.
- Bronx fixed broadband: the 63.3% source value and label are supported; fixed-only scoring against generic broadband access needs an explicit contract. Use an unscored related observation meanwhile.
- Staten Island fixed broadband: the same construct issue affects 76.5%. Use an unscored related observation meanwhile.

**Scientific dispositions**

NYC water remains uncertain because annual newly entered violations and a historical addressed treatment-technique violation answer different regulatory questions. Withholding scores is justified. This does not prove that each former 0 or 100 endpoint was categorically false or that zero residents had safe tap water. All borough records refer to shared system context.

The Bronx waste error is reproducible: removing January gives exactly both prior incorrect inputs. Full calendar-year reduction is 6.44%. NYC fiscal-year reduction is 12.55%. DSNY refuse collected measures neither final landfill destination nor all privately collected waste, so both are unscored disposal proxies.

TRI sums quantified Form R releases in Pounds. Form A quantities remain unknown. Two Jamestown facilities were excluded by documented facility geography. Neither the city nor Bronx quantity is scored as an exhaustive total-release measure.

Conservation source tables include land and water. Their 19.5% aggregate cannot support a land-only 30% target. The erroneous unrounded exhibit calculation still requires correction.

Santa Cruz city PIT total 1,024 conflicts with 789 + 234 = 1,023 and the subtotals. Preserve the printed figure as uncertain and unscored. Watsonville 303 and county 1,648 reconcile. Enumeration dates, undercoverage and changed safe-parking/sleeping inclusion remain visible.

Primary rent-burden tables support at-least-30% shares of 55.7% for Carmel (2020–2024 five-year) and 58.0% for Monterey County (2024 one-year). Strict-over-30% identification bounds are 45.79288026–55.66343042% and 48.30309112–57.98937273%, respectively. These are bin-identification bounds, not sampling confidence intervals. No combined ratio MOE, exact strict-share score or new threshold is inferred. Historical inherited review notes are not this review.

The heat mean 14.757709506983256 reproduces from 69 county tracts, 3,963,492.8 weighted days and 268,571 estimated resident weights. The sole omitted Census 2020 tract has zero population and land. The [CDC primary documentation](https://atsdr.cdc.gov/place-health/php/eji/eji-indicators-climate-burden-module.html) confirms the 2018–2022 annual-mean period. An explicit local-extreme-heat-v1 profile is required; target, score and wedge stay null. Santa Cruz and Watsonville must visibly identify county-proxy context. This publisher documentation shares CDC provenance with the data and is not independent measurement triangulation.

The aragonite paper supports seasonal western Long Island Sound bottom-water Ω = 1.09. The framework calls for coastal Ω and does not require annual surface-only sampling. Bronx’s inherited regional proxy preserves that limitation and its existing threshold arithmetic; Staten Island receives unscored regional context. Neither is a borough-specific annual reading.

All nine gap records match their original frozen findings. Retain them as unresolved with the evidence needed to close each gap. This audit does not claim a new exhaustive search for every gap.

**Exact bindings**

- `findings/amendments.json`: `8a4f14c2b14a2ac501f3eb884819bd74c134abf3b4283d6bc7936001ab69866a`
- `findings/supplemental-housing.json`: `0b7508b08a4ea7af36a32850f13aec3e578f2897a5fc6e4b41960fbe7ce21d30`

Baseline portrait SHA-256: `a5e318a6bc47afe632dbd1aab17ea354e68279af02ad2c59b18cd43011964d2b`. Per-amendment canonical hashes, full source bindings, reasons and integration conditions are in `independent-sol-high.json`.

**All initial verdicts**

| Amendment | Verdict |
| --- | --- |
| `nyc:air-pollution:0` | accept |
| `bronx:food:0` | accept |
| `nyc:water-sanitation:0` | accept |
| `manhattan:water-sanitation:0` | accept |
| `brooklyn:water-sanitation:0` | accept |
| `queens:water-sanitation:0` | accept |
| `bronx:water-sanitation:0` | accept |
| `staten-island:water-sanitation:0` | accept |
| `nyc:chemical-pollution:1` | revise |
| `bronx:chemical-pollution:1` | accept |
| `bronx:climate-change:0` | accept |
| `bronx:climate-change:1` | accept |
| `bronx:climate-change:2` | accept |
| `nyc:chemical-pollution:0` | accept |
| `bronx:chemical-pollution:0` | accept |
| `nyc:biodiversity-loss:0` | revise |
| `bronx:ocean-acidification:0` | accept |
| `staten-island:ocean-acidification:append` | accept |
| `santa-cruz:social-equity:0` | accept |
| `santa-cruz:income-work:0` | accept |
| `santa-cruz:networks:0` | accept |
| `watsonville:social-equity:0` | accept |
| `watsonville:income-work:0` | accept |
| `watsonville:networks:0` | accept |
| `santa-cruz-county:social-equity:0` | accept |
| `santa-cruz-county:networks:0` | revise |
| `bronx:networks:0` | revise |
| `staten-island:networks:0` | revise |
| `santa-cruz:housing:0` | accept |
| `watsonville:housing:0` | accept |
| `santa-cruz-county:housing:0` | accept |
| `santa-cruz:ozone-layer-depletion:0` | accept |
| `watsonville:ozone-layer-depletion:0` | accept |
| `santa-cruz-county:ozone-layer-depletion:0` | accept |
| `carmel:housing:0:primary-supplement` | accept |
| `monterey-county:housing:0:primary-supplement` | accept |

The separate `reviewer-suggested-corrections.json` batch proposes fixes for the five revisions. Its author’s checks are labeled corrective self-checks and require review by another agent. They do not alter the frozen initial verdicts.

This review covers the proposed amendments, not untouched legacy claims. It reads frozen primary bytes and existing exhibits without rerunning author extraction scripts. Only the EJI period documentation was newly opened on the public web. The complete ECHO screenshot is very tall; archived HTML/text supports detailed checking.

Activity is recorded in `independent-sol-high-activity.json`. Actual tokens and billed USD remain null. Activity counts can support explicitly assumed cost scenarios; they are not measured invoices.
