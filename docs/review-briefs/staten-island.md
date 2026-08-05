# Staten Island Doughnut Portrait — Human Review Brief

## Summary

Of 7 red-flagged findings adjudicated, **5 are approved** as-is (verifier failures were fetch-blocks or misreadings of the portrait's disclosed citywide-at-regional-scale convention) and **2 need edits** (a rounding fix and a source-URL swap); there are **0 re-research and 0 rejects**. The tier audit passed 4 of 5 claims, with one downgrade: **poverty-rate** is genuinely federal ACS data republished by a city agency, so its tier-1 claim fails. The audit also surfaced a **better source for pm25-annual**: DOHMH publishes an official borough annual mean (5.9 µg/m³) that should replace the hand-derived 6.0.

## Dispositions (red-flagged findings)

| Dimension | Indicator | Disposition | Reason / correction |
|---|---|---|---|
| water-sanitation | safe-drinking-water | **Approve** | Verifier only hit a nyc.gov 403; independent sources confirm DEP's unified system met all 2024 standards for all five boroughs. |
| climate-change | ll97-over-2030-cap-share | **Approve** | Urban Green Council confirms 57% over 2030 cap; citywide scope is explicitly disclosed at `regional` scale per portrait convention. |
| climate-change | ghg-reduction-vs-2005 | **Edit** | Researcher double-rounded: correct value is **25.2%** (not 25.3), level_pct **68.5**; source/scope/target otherwise correct (NYC Open Data wq7q-htne). |
| climate-change | ghg-per-capita | **Approve** | Arithmetic reproduced (5.66 tCO2e); verifier's fail rests only on the disclosed citywide-for-borough convention, same as ghg-reduction-vs-2005. |
| land-conversion | park-access-share | **Approve** | NYC Parks page 403s to bots but indexed content matches verbatim (84.2%, July 2025, 85% target); citywide geography honestly labeled. |
| land-conversion | tree-canopy-pct | **Edit** | Value 33.1% is correct, but swap source_url to the full Urban Forest Plan PDF (report.urbanforestplan.nyc/NYC-Urban-Forest-Plan-2026.pdf) — the cited press release lacks the borough table. |
| biodiversity-loss | protected-land-share | **Approve** | Numerator reproduced by verifier itself; verifier used stale 2010 land area — 2020 Gazetteer (57.523 sq mi) makes 20.97% reproduce exactly; city-only undercount already flagged in notes. |

## Tier audit

| Indicator | Tier claim | Note |
|---|---|---|
| poverty-rate | **Fails** | DSS/OER deck republishes federal ACS 2024 estimates — primary producer is federal (tier 2); the city-produced NYCgov measure (15.6%, 2022) is a different methodology, not a substitute. |
| voter-turnout | OK | CFB Voter Analysis Report is charter-mandated tier 1; no more-primary NYC publication of the 45.6% figure found. |
| traffic-deaths | OK | DOT year-end release is the most primary published source of the finalized count of 13; the open dataset's borough subsets don't reproduce it. |
| violent-crime-rate | OK | NYPD numerator is tier 1; the derived rate uses a disclosed tier-2 ACS denominator via Census Reporter. |
| pm25-annual | OK, **better source found** | Finding wrongly claims no borough aggregate exists — DOHMH's own portal publishes Staten Island 2024 = **5.9 µg/m³**; should replace the hand-derived 6.0. |

## Do these first

1. **Apply the ghg-reduction-vs-2005 edit** — value 25.2, level_pct 68.5 — it changes a headline dimension score.
2. **Replace pm25-annual with the DOHMH borough figure (5.9)** and cite the Environment & Health Data Portal — swaps a hand-derived number for an official published one.
3. **Downgrade poverty-rate's source tier to 2** (federal ACS via city republication) or decide whether the NYCgov measure is preferable despite the methodology change.
4. **Swap the tree-canopy-pct source_url** to the Urban Forest Plan PDF — quick fix, value unchanged.
5. Approve the remaining 5 cards as-is; no re-research required this pass.
