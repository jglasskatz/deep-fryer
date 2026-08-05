# NYC Doughnut Portrait — Human Review Brief

## Summary

Of 15 red-flagged findings adjudicated: **8 approve**, **3 edit**, **2 re-research**, **2 reject** — most verifier fails were derived-value or capture-access issues, not data errors. The two re-research items are real source conflicts: safe-drinking-water 0% contradicts the verified DEP 2024 report, and ghg-per-capita 5.3 contradicts its own cited MOCEJ deck (~6.2 tCO2e). Tier audit: all 5 sampled tier-1 claims hold; one finding (ghg-reduction from the 2023 MOCEJ deck) is redundant/stale vs. the NYC Open Data inventory sibling, and the landfill Open Data finding carries a derivation-without-snapshot caveat.

## Dispositions

| Dimension | Indicator | Disposition | Reason / correction |
|---|---|---|---|
| food | food-insecurity-rate | approve | 16.8% citywide (2023) and borough spread confirmed verbatim in captured Food by the Numbers PDF; verifier simply returned no verdict. |
| income-work | below-tcol-share | **edit** | 62% confirmed, but year → **2022** (report's own tables say 2022, not 2024); strike the "2024 ACS adjusted to 2026" note. |
| water-sanitation | safe-drinking-water (100%) | approve | DEP 2024 report states verbatim NYC "met all drinking water standards in 2024"; single-system city maps to 100%. |
| water-sanitation | safe-drinking-water (0%) | **re-research** | 0% is an unsourced inference from a 2017 Hillview LT2 SDWIS entry and conflicts with the verified DEP report; fresh session must settle legacy-vs-reporting-year violation methodology. |
| networks | broadband-access (74%) | approve | 74% follows directly from the Roadmap's own 17% mobile-only + 9% none (2023 ACS PUMS); derivation and rounding disclosed. |
| networks | broadband-access (91%) | **reject** | 91% only emerges by counting mobile-only as broadband — the source classifies those as under-connected; covered by the 74% sibling (re-source to ACS S2801 if "any type" is later preferred). |
| housing | homelessness-rate | **edit** | Numerator 82,908 confirmed; denominator superseded — use Vintage 2025 pop 8,584,629 → rate **96.6 per 10,000** (was 97.8). |
| peace-justice | violent-crime-rate (5.51) | approve | All four NYPD 2025 felony counts and the DCP 8,584,629 denominator verified; 5.51/1,000 math checks; verifier fail was "derived, not printed". |
| peace-justice | violent-crime-rate (5.48) | approve | SoQL aggregation independently reproduced (46,421 felonies / 8,478,072 = 5.48); verifier's "dataset ends 2019" claim is stale metadata. |
| climate-change | ghg-per-capita | **re-research** | Cited MOCEJ deck itself shows ~6.2 tCO2e and ~51 MMT for 2023, not 5.3 / 44; re-pull from the official GHG inventory data (Open Data wq7q-htne or climate.cityofnewyork.us). |
| chemical-pollution | tri-releases-per-capita (0.0199) | approve | EPA Envirofacts re-query reproduced 164,217.91 lb across 5 counties exactly; verifier's differing total was its own extraction error. |
| chemical-pollution | tri-releases-per-capita (0.0182) | **reject** | CSV extraction dropped rows (Queens, Kings, New York County all understated), no evidence capture, wrong geographic_scale; duplicate of the approved 0.0199 finding. |
| chemical-pollution | landfill-reduction-vs-2005 | approve | 3,154,600 tons (MMR FY2025) and 3.6M-ton 2005 baseline (Climate Action Tracker) both verified → 12.37%; multi-source derivation and low confidence already disclosed. |
| biodiversity-loss | protected-land-share | **edit** | 6.36% checks out, but source_url → NYC Parks Forever Wild page (nycgovparks.org/greening/nature-preserves), which actually states the 12,400 acres. |
| air-pollution | pm25-annual | approve | Independently parsed Appendix3 Table A3-1: mean of 59 CD values = 6.65 µg/m³, range matches; unweighted-mean caveat already disclosed in payload. |

## Tier audit (5 sampled)

All 5 tier-1 claims verified genuine. Notes: **ghg-reduction-vs-2005 (0047e07d)** — tier holds but the 2023 MOCEJ-deck finding is redundant and stale next to sibling 1169b0e1 (Open Data inventory, 2024 data, −25.25% built-in); prefer the sibling. **landfill-reduction (011a0051)** — tier-1 fine, but the 12.92% is session-computed from raw tonnage rows and its evidence snapshot capture failed.

## Do these first

1. **Kick off the two re-research sessions** (safe-drinking-water 0% and ghg-per-capita) — both are active contradictions with tier-1 sources and block their dimension cards.
2. **Apply the homelessness edit** (denominator → Vintage 2025, rate 96.6/10k) — same denominator vintage as the approved violent-crime finding, so it also keeps the portrait internally consistent.
3. **Apply the below-tcol year edit (2024 → 2022)** — the value ships as-is but the year misattribution materially misdates the measure.
4. **Delete the two rejects** (91% broadband, 0.0182 TRI) so the approved siblings stand alone per indicator.
5. **Decide the ghg-reduction duplicate**: retire the 2023 MOCEJ-deck finding in favor of the Open Data inventory finding (newer year, more primary, machine-readable).
6. **Apply the protected-land source_url swap** — one-line fix, no value change.
7. Pick a canonical violent-crime finding (5.51 vs 5.48) — both approved, but the card should show one; 5.51 shares the newer population vintage.
