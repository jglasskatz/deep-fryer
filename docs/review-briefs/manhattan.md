# Manhattan Doughnut Portrait — Human Review Brief

## Summary

Of the 6 red-flagged findings adjudicated, **5 are approved** and **1 needs an edit** (climate-change GHG per-capita: off-by-one-column read of Table 4); there are **no re-research or reject dispositions** — every verifier "fail" except the GHG one was a false alarm (mistaken sanity checks or objections to transparently disclosed derivations). The tier audit passed 3 of 5 claims and flagged **2 inaccurate tier-1 self-reports**: food-insecurity (NYC PDF repackages Feeding America tier-3 estimates) and protected-land-share (composite with a tier-2 federal denominator). Net: one value correction, two tier-label corrections, and three optional source upgrades.

## Dispositions

| Dimension | Indicator | Disposition | Reason / correction |
|---|---|---|---|
| climate-change | ghg-per-capita | **EDIT** | Value is **13** tCO2e (not 12 — that's Queens's column) per Table 4 of the NYC Household Consumption-Based GHG Inventory; recompute level_pct = **420.0**, fix notes (citywide avg is 11, not 12; ~2.08 persons/household). |
| water-sanitation | safe-drinking-water | Approve | NYS DOH page states verbatim "no violations entered in SDWIS/State for 2024"; 100% follows deterministically from NYC's single unified PWSID, and the derivation is disclosed in notes. |
| peace-justice | violent-crime-rate | Approve | Socrata query independently reproduced (8,992 violent complaints / 1,660,664 = 5.41); verifier's fail used all 44,604 felonies instead of the documented 4-offense violent subset. |
| chemical-pollution | tri-releases-per-capita | Approve | Verifier queried the wrong table (one-time releases, legitimately null); tri_release_qty confirms 1.15 lb total and 7.199e-7 per capita; PBT 100-lb threshold explains tiny reported releases. |
| land-conversion | tree-canopy-pct | Approve | Verifier returned no verdict (source 403s); independent press coverage of the Urban Forest Plan borough table confirms Manhattan 22.7% (2021 LiDAR), citywide 23.4% cross-checked twice. |
| air-pollution | pm25-annual | Approve | Verifier itself confirmed all 12 CD values and the 7.84 mean; its only objection was that the mean is derived, which the notes already disclose (DOHMH publishes no borough composite). |

## Tier audit

| Indicator | Verdict | Note |
|---|---|---|
| food-insecurity-rate | **Tier claim wrong** | NYC PDF repackages Feeding America Map the Meal Gap (tier 3) — re-attribute to the true producer. |
| protected-land-share | **Tier claim wrong** | Researcher-built composite; denominator is federal Census Gazetteer (tier 2), no NYC source publishes the 3.02%. |
| class-size-compliance | OK | Genuinely tier 1; DOE borough xlsx would give a Manhattan-specific value. |
| traffic-deaths | OK | Tier-1 press release; Vision Zero View dataset (v7f4-yzyg) is the more primary machine-readable source. |
| residential-gpcd | OK | Tier fine, but 115 GPD is total system demand, not residential-only — a content mismatch to keep on the record. |

## Do these first

1. **Apply the GHG edit** — value 13, level_pct 420.0, corrected notes — it's the only actual data error and it moves an overshoot metric by a full point.
2. **Re-label food-insecurity-rate as tier 3** (Feeding America, New York County) — the current tier-1 claim misrepresents the data producer.
3. **Fix protected-land-share's tier label** to Tier-1/Tier-2 composite, or swap the denominator to NYC DCP Borough Boundaries (dataset tqmj-j8zm) to make it NYC-primary end to end.
4. **Approve the other 5 adjudicated cards as-is** — all verifier objections were disproven with independent re-checks; no re-research needed.
5. *(Optional upgrades, no urgency)*: pull the Manhattan row from the DOE class-size borough xlsx, and cite Vision Zero View (v7f4-yzyg) alongside the DOT press release.
