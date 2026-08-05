# Bronx Doughnut Portrait — Human Review Brief

## Summary

Of 13 adjudicated red-flag findings, **11 are approved as-is** and **2 need edits** (health/life-expectancy relabel; chemical-pollution/landfill-reduction value correction) — zero re-research, zero rejects, and most verifier fails were methodology objections to derivations the findings already disclose. The tier audit passed 3 of 5 claims; **homelessness-rate and cost-burdened-renters cannot be claimed as tier 1** (both depend on federal Census/ACS data) and need tier downgrades, not new sourcing. Note that the three pm25-annual findings are duplicates — keep one.

## Dispositions

| Dimension | Indicator | Disposition | Reason / correction |
|---|---|---|---|
| food | food-insecurity-rate | Approve | 20.2% / 290,990 confirmed; contested 2022 data year corroborated by Food Bank NYC FY2026-Q1 (MMG releases lag two years). |
| housing | homelessness-rate | Approve | 20,424 / 1,384,724 × 10,000 = 147.5 independently reproduced; computed rate, so no published per-10,000 field expected. |
| health | life-expectancy | **Edit** | Relabel period from "2022" to "2013–2022 (pooled)" per DOHMH CHP metadata; value 79.7 yrs and Bronx geography stand. |
| water-sanitation | safe-drinking-water | Approve | NYS DOH states zero 2025 SDWIS violations for the NYC system; 100%-served is a valid definitional derivation, disclosed in notes. |
| peace-justice | violent-crime-rate | Approve | 14,093 / 1,406,332 (Census Vintage 2025, FRED NYBRON5POP) × 1,000 = 10.02 exactly; verifier tested denominators the finding never claimed. |
| climate-change | ghg-reduction-vs-2005 | Approve | 25.25% reproduced from Socrata (2005→2024); explicitly a citywide/regional indicator, so "no Bronx field" objection misreads it. |
| climate-change | ll97-over-2030-cap-share | Approve | 57% citywide over-cap confirmed by verifier itself; carried at regional scale by design. Minor notes-only fix available (multifamily 54% → 46%). |
| air-pollution | pm25-annual | Approve | All 12 Bronx CD 2024 values match Table A3-1; 78.1/12 = 6.51 unweighted mean, disclosed in payload. |
| air-pollution | pm25-annual (dup) | Approve | Duplicate of above — same value, source, and verification. **Keep only one of the three.** |
| air-pollution | pm25-annual (dup) | Approve | Duplicate; values, arithmetic, and non-weighted-mean caveat all check out. |
| climate-change | ghg-per-capita | Approve | 47,944,551.47 tCO2e / 8,478,072 = 5.66 reproduced; documented derivation, honestly labeled regional. |
| chemical-pollution | tri-releases-per-capita | Approve | Envirofacts join reproduces 1,355.76 lbs (sole Bronx TRI facility); / 1,406,052 pop = 0.000964 lbs/resident. |
| chemical-pollution | landfill-reduction-vs-2005 | **Edit** | Finding's totals are wrong (132-row/11-district sums irreproducible). Correct to: 6.44% reduction = (556,777.75 − 520,903.27) / 556,777.75; level_pct = 92.84. |

## Tier audit

| Indicator | Tier claim | Action |
|---|---|---|
| uninsured-rate | OK (city-primary CHS) | None |
| below-tcol-share | OK (sole publisher, charter-mandated) | None |
| new-affordable-homes-per-year | OK (HPD raw administrative record) | None |
| homelessness-rate | **Fail** — denominator is federal PEP Vintage 2025 | Downgrade composite rate from tier 1; keep numerator's tier-1 attribution |
| cost-burdened-renters | **Fail** — RGB republishing ACS 2024 | Downgrade to tier 2; no borough-level HVS alternative confirmed |

## Do these first

1. **Apply the landfill-reduction correction** (chemical-pollution): the published value is built on wrong Socrata totals — replace with 6.44% reduction / 92.84 level_pct. This is the only finding where the number itself is wrong.
2. **Relabel life-expectancy period** to "2013–2022 (pooled)" — materially misleading across the COVID years as currently labeled; value unchanged.
3. **Dedupe pm25-annual**: keep one of the three identical findings, delete the other two.
4. **Downgrade tier claims** on homelessness-rate and cost-burdened-renters per the audit — no re-research needed, just honest labeling.
5. Optional cleanup: fix the ll97 notes discrepancy (multifamily compliance 54% → 46%) and note the ghg-reduction missing evidence snapshot is a known infrastructure gap, not a sourcing defect.
