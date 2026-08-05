# Human Review Brief — "brooklyn" Doughnut Portrait Queue

## Summary

Of 9 red-flagged findings adjudicated, 6 are approved (the verifier's objections were mistaken or reflected documented composites/citywide labeling, not errors), 3 need edits (small numeric corrections with sources confirmed), and none require re-research or rejection. The three edits are all value-level fixes: a rounding error (GHG reduction 25.3 → 25.2), a stale denominator (protected land share 10.73 → 10.95 using 2020 Census land area), and a single transcription error (PM2.5 CD13 value 6.5 → 5.9, mean 6.54 → 6.51). The tier audit passed 5/5 — every tier-1 claim holds — with one improvement flagged: class-size compliance uses the citywide 64% figure even though DOE's same November 2025 release includes a Brooklyn-specific borough workbook.

## Dispositions

| Dimension | Indicator | Disposition | Reason / Correction |
|---|---|---|---|
| peace-justice | violent-crime-rate | Approve | Independently re-ran Socrata query and Census population; 4.88 per 1,000 confirmed exactly — verifier's "uncertain" reflects only the documented composite, not an error. |
| climate-change | ll97-over-2030-cap-share | Approve | 57% is the exact complement of Urban Green's 43%-compliant figure; correctly labeled citywide, contrary to the verifier's charge. |
| climate-change | ghg-reduction-vs-2005 | **Edit** | Sums confirmed, but reduction is 25.2498% → value 25.2 (not 25.3); level_pct 68.5. Source unchanged. |
| climate-change | ghg-per-capita | Approve | 47,944,551.47 tCO2e ÷ 8,478,072 (Vintage 2024, not the 2020 count as verifier asserted) = 5.66; explicitly labeled citywide. |
| chemical-pollution | tri-releases-per-capita | Approve | Re-parsed RY2024 TRI file: 22 rows sum to 44,293.487 lbs, matching line-by-line; verifier never ran (url_ok false is a download artifact). Minor: notes say "21 records," should be 22. |
| land-conversion | park-access-share | Approve | NYC Parks' 84.2% sentence verified; finding is explicitly labeled city-scale with notes explaining no Brooklyn breakout exists — verifier's geography objection mistaken. |
| land-conversion | tree-canopy-pct | Approve | TNC's 23.40% (2021) confirmed verbatim; honestly labeled city-scale, and notes already flag the ~19.5% Brooklyn figure as a preferred future substitute. |
| biodiversity-loss | protected-land-share | **Edit** | Numerator (4,864.078 acres) reproduced, but denominator was 2010 vintage → use 69.377 sq mi (2020 Gazetteer): value 10.95 (not 10.73); level_pct 63.5; drop the "Census 2020" claim on 70.82 sq mi. |
| air-pollution | pm25-annual | **Edit** | 17 of 18 CD values match NYCCAS Appendix 3, but CD13 Coney Island is 5.9, not 6.5 → sum 117.2, value 6.51 (not 6.54); level_pct 30.2. |

## Tier Audit

All 5 sampled indicators (class-size-compliance, below-tcol-share, new-affordable-homes-per-year, traffic-deaths, landfill-reduction-vs-2005) verified as genuine tier 1 with no more-primary source publishing the same figure — **one upgrade available**: class-size-compliance should switch to DOE's Brooklyn-specific borough workbook (november-2025-26-class-size---borough.xlsx) from the same InfoHub release instead of the citywide 64%.

## Do These First

1. **Apply the three edit corrections** (ghg-reduction-vs-2005 → 25.2 / 68.5; protected-land-share → 10.95 / 63.5 with 2020 Gazetteer denominator; pm25-annual → 6.51 / 30.2 with CD13 = 5.9) — all are drop-in value fixes with corrections fully specified, no new research needed.
2. **Swap class-size-compliance to the DOE Brooklyn borough workbook** — a Brooklyn-specific figure exists in the same source release and was skipped; this is the only geography upgrade available in the queue.
3. **Fix the "21 records" → 22 note in tri-releases-per-capita** while approving it — cosmetic, but keeps the payload internally consistent.
4. Approve the remaining five as-is; each was independently reproduced against the primary source and the verifier objections were shown to be mistaken.
