# Queens Doughnut Portrait — Human Review Brief

## Summary

Of 9 red-flagged findings adjudicated, 7 are approved, 1 needs an edit (gender-pay-ratio: value correct, source string must be fixed to name the full-time year-round universe), and 1 needs re-research (safe-drinking-water: EPA SDWIS shows an open LT2 treatment-technique violation for NY7003493 that likely flips the value from 100% to 0%); none were rejected. The tier audit passed all 5 sampled indicators — every tier-1 claim holds, with only housekeeping notes (protected-land-share quietly uses a tier-2 Census land-area denominator; class-size-compliance has an available Queens-specific borough xlsx). Net: the queue is in good shape, with one substantive data risk (drinking water) and a handful of small corrections.

## Dispositions

| Dimension | Indicator | Disposition | Reason / correction |
|---|---|---|---|
| water-sanitation | safe-drinking-water | **re-research** | Open EPA SDWIS health-based TT violation (LT2, Hillview Reservoir, since 2017) contradicts the "0 violations" basis; re-query Envirofacts, decide reference-period treatment, cross-check County Health Rankings, restate value. |
| gender-equality | gender-pay-ratio | **edit** | 100.7% is correct for FT/YR workers (B20017: M $62,041 / F $62,453), but source string names the all-workers universe (88.9%); replace with the FT/YR-row citation, keep low confidence + MOE caveat. |
| food | food-insecurity-rate | approve | Evidence capture shows Feeding America 2024 map: 15.5%, 360,330 people; verifier was only blocked by client-side rendering, and value fits the borough series trajectory. |
| peace-justice | violent-crime-rate | approve | Independently reproduced: 9,188 CY2025 violent felonies (cmplnt_fr_dt) / 2,316,841 pop = 3.97 per 1,000; verifier's 9,425 came from filtering on rpt_dt instead. |
| climate-change | ll97-over-2030-cap-share | approve | Urban Green Council confirms 57% over 2030 caps (2024 data); citywide scope is disclosed as 'regional' per the region brief's mismatch convention — no borough breakdown exists. |
| climate-change | ghg-per-capita | approve | Re-verified 47.94M tCO2e / 8,478,072 = 5.66; explicitly labeled 'regional' since citywide inventories are never apportioned to boroughs — verifier's geography objection is mistaken. |
| land-conversion | park-access-share | approve | Live NYC Parks page confirms 84.4% within walking distance (July 2026) and 85%-by-2030 target; honestly labeled 'city' scale with sub-borough exclusions documented. |
| land-conversion | tree-canopy-pct | approve | Captured NYC Urban Forest Plan PDF directly confirms Queens 19.5% canopy (2021). Housekeeping: PNG snapshot (914f7ccb8c0e.png) is an Access Denied page — re-capture it. |
| air-pollution | pm25-annual | approve | NYCCAS Appendix 3 Table A3-1 matches all 14 Queens CD values; 6.07 µg/m³ is a transparently disclosed session-computed mean, with weighting flagged for follow-up. |

## Tier audit — all 5 pass

- class-size-compliance, new-affordable-homes-per-year, ghg-reduction-vs-2005, landfill-reduction-vs-2005, protected-land-share: tier-1 claims all confirmed as genuine agency primary data.
- Notes: protected-land-share's 11.06% depends on a Census (tier-2) denominator — a DCP Borough Boundaries denominator exists if NYC-native sourcing is preferred; class-size-compliance could be upgraded to a Queens-specific figure via the InfoHub borough xlsx.

## Do these first

1. **Re-research safe-drinking-water** — the only finding whose value may be wrong (100% → possibly 0%); run the prescribed Envirofacts query and settle the reference-period question before publishing.
2. **Apply the gender-pay-ratio source-string edit** — value stands, citation is misleading as written.
3. **Re-capture the tree-canopy PNG evidence** (914f7ccb8c0e.png is an Access Denied page; the PDF is authoritative, so this is evidence hygiene only).
4. Optional upgrades from the tier audit: swap protected-land-share to the DCP denominator and/or pull the Queens borough xlsx for class-size-compliance.
