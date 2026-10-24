"""Keep human-facing fields legible; raw source identifiers and before records are untouched."""
from pathlib import Path
import json,re
B=Path(__file__).resolve().parent
p=B/'findings/amendments.json';j=json.loads(p.read_text())
replacements={'sourcecapture':'source capture','sourcecapture':'source capture','Missing source exhibit restored.':'Missing source exhibit restored.','fixed-versus-anybroadband':'fixed versus any broadband','full-year':'full year','single-nightsnapshot':'single-night snapshot','county-as-city':'county as city','citywide regionalproxy':'citywide regional proxy','notannualpersonsserved':'not annual persons served','notallresidentpopulation':'not the full resident population','citylimits':'city limits','regionalcontext':'regional context','No StatenIsland-specific':'No Staten Island-specific','householdincome':'household income','localcityexposure':'local city exposure','notfixedcable/fiber/DSL':'not fixed cable/fiber/DSL','safeannualdaytargetdefined':'safe annual-day target defined','frameworkland-only':'framework land-only','neitherannual':'neither annual','no newnumericthreshold':'no new numeric threshold','proxy score':'proxy score','coveredbuildings':'covered buildings','safeparking/sleeping':'safe parking/sleeping','safeparking':'safe parking','safesleeping':'safe sleeping','notnewlyreconfigured':'not newly reconfigured','norcity':'nor city','fixedbroadband':'fixed broadband','BroadbandofANYtype':'Broadband of ANY type','broadbandofANYtype':'broadband of ANY type','ofANYtype':'of ANY type','no scoreasserted':'no score asserted','notmeasuredzeros':'not measured zeros','Not measuredzeros':'Not measured zeros'}
def tidy(s):
 for old,new in replacements.items():s=s.replace(old,new)
 s=re.sub(r'(?<=[a-z])(?=[A-Z])',' ',s)
 s=re.sub(r'(?<=[a-z])(?=\d)',' ',s)
 s=re.sub(r'(?<=\d)(?=[A-Za-z])',' ',s)
 s=re.sub(r'([,;:])(?=[A-Za-z])',r'\1 ',s)
 return s
for a in j['amendments']:
 for k in ['name','notes','source','geography','unit']:
  if isinstance(a['after'].get(k),str):a['after'][k]=tidy(a['after'][k])
 a['reason']=tidy(a['reason'])
 for s in a['source_support']:
  for k in ['period','scale','reuse_note']:
   if isinstance(s.get(k),str):s[k]=tidy(s[k])
 # Override especially consequential explanations with readable, exact notes.
 p0,d=a['portrait'],a['dimension']
 if d=='water-sanitation':a['after']['notes']='NYSDOH says no violations were entered in SDWIS/State for 2025, and DEP reports meeting all drinking-water standards in 2025. EPA ECHO concurrently lists treatment-technique violation #20170201, beginning February 1, 2017, as Addressed under a May 15, 2019 federal consent decree; recent quarters remain Violation-Addressed. These describe different annual and historical compliance constructs. Neither proves that zero residents had safe tap water. The configured population-with-no-health-based-violations indicator cannot be scored consistently until the reporting period and treatment of addressed historical violations are resolved. Borough evidence refers to the shared NYC system.'
 if d=='housing' and p0 in ['santa-cruz','santa-cruz-county','watsonville']:
  a['after']['notes']='The 2026 PIT report, physical page 13, reports one-night counts by jurisdiction. Street enumeration occurred January 29, with shelter occupancy from January 28. The count excludes some forms of homelessness and is not annual persons served. Newly included safe parking/sleeping records added 124 people in Santa Cruz city and 2 in Watsonville compared with prior practice, so annual changes are not directly comparable. The legacy 1,850 was the 2024 COUNTY total, not Santa Cruz city. Housing cost burden remains a separate unresolved measure. No count-based score is inferred from the legacy combined prose target.'
  if p0=='santa-cruz':a['after']['notes']+=' Source arithmetic conflict: the published city total is 1,024, but 789 unsheltered + 234 sheltered = 1,023; incorporated and county subtotals also support 1,023. Retain uncertainty and do not silently repair the source.'
  elif p0=='watsonville':a['after']['notes']+=' Watsonville: 179 unsheltered + 124 sheltered = 303.'
  else:a['after']['notes']+=' County: 1,290 unsheltered + 358 sheltered = 1,648.'
 if d=='ozone-layer-depletion':
  a['after']['notes']='CDC EJI 2024 reports tract means of locally extreme heat days during 2018–2022, defined using a local 95th-percentile maximum-temperature threshold. Population-weighted county mean: 14.757709506983256 days/year across 69 EJI tracts. Census 2020 coverage was independently checked; the omitted tract has zero population and zero land area. No safe annual-day target was established, so target, score and wedge must remain null. For Santa Cruz city and Watsonville, this is explicitly a Santa Cruz County proxy, not a city-limit observation. Integration requires an explicit local-extreme-heat-v1 profile replacing the legacy ozone dimension for these three portraits only.'
 a['field_diff']={k:{'before':(a['before'] or {}).get(k),'after':v} for k,v in a['after'].items() if (a['before'] or {}).get(k)!=v}
p.write_text(json.dumps(j,indent=2,ensure_ascii=False)+'\n')
# Faithful exhibits use clear explanatory prose; numerical tables remain verbatim.
paragraphs={
'nyc-waste-extract': ['Every year contains 12 months and unique month/borough/community-district records. The Bronx has 12 districts × 12 months = 144 rows. The prior Bronx calculation used only 132 rows and omitted January in both years.','Full CY2005 total 556,777.75 minus January 43,355.90 = 513,421.85 tons. Full CY2025 total 520,903.27 minus January 42,199.80 = 478,703.47 tons. These exactly reproduce the prior incorrect inputs.','This dataset measures DSNY refuse collected. It does not establish final landfill disposal or include all private commercial waste. Fiscal years run July–June; calendar years run January–December.'],
'nyc-ghg-extract':['NYC community inventory totals use 100-year global warming potentials. Borough displays are citywide regional proxies, not borough-specific emissions.','For the 2024 inventory, 5.66 tCO2e/resident follows the Census Vintage 2024 denominator; 5.58 follows the revised Vintage 2025 denominator. The difference reflects a population revision. The full 85-row inventory and all five same-vintage county population rows are archived.'],
'nyc-tri-extract':['The EPA source contains 1,509 New York reporting-year 2024 rows. Two records assigned county NEW YORK belong to the Jamestown Blackstone facility, outside Manhattan, and are excluded using the source facility address and coordinates.','Form A certifications do not quantify releases. Zero placeholders in the basic export are not measurements of zero. This extract sums quantified Form R releases only; it does not measure all pollutants, facilities, exposure, or true total releases.'],
'nyc-conservation-extract':['The five county totals sum to 43,374 protected acres / 222,182 total acres × 100 = 19.52273360%. The source explicitly includes both LAND AND WATER in its protected area and denominator.','A land-only share cannot be recovered from these aggregate tables. The reproduced 19.5% must not be scored as the framework percent of jurisdiction land area.'],
'nyc-ocean-extract':['Barrett et al. (2024), Table 1: the 2022 July–September mean bottom-water aragonite saturation in western Long Island Sound, west of longitude −73°, is 1.09 ± 0.00.','This is seasonal bottom-water regional context. It is not a citywide annual surface-ocean mean or a measurement at each borough coast.'],
'sc-census-extract':['Cities: 2020–2024 ACS five-year estimates. County Gini: 2024 ACS one-year estimate. Exact legal city/county GEO_IDs are retained below; urban areas and PUMAs are not substituted.','Estimates have 90% margins of error. Constituent MOEs are retained in the raw tables; no combined-ratio MOE was calculated. The national raw source files are compressed losslessly and checked against their original SHA-256 hashes.'],
'sc-heat-extract':['Population-weighted county mean of tract annual extreme-heat days during 2018–2022, from CDC EJI 2024. The measure uses a local 95th-percentile maximum-temperature definition. It is not an absolute heat-index threshold, a count of simultaneous countywide events, or a future projection.','Weighted sum 3,963,492.8 / population weights 268,571 = 14.757709506983256 days/year across 69 EJI tracts. Census 2020 lists 70 county tracts; omitted water-only tract 06087990100 has zero population and zero land area. No inhabited tract omission was found.','No defensible safe annual-day target was established. Target, score and wedge must remain null. Santa Cruz city and Watsonville would show explicit COUNTY CONTEXT, not city-limit measurements. Integration requires an explicit profile replacing ozone for these three portraits.']}
for stem,paras in paragraphs.items():
 f=B/'calculations'/f'{stem}.html';s=f.read_text();found=list(re.finditer(r'<p>.*?</p>',s,re.S))
 for m in reversed(found[1:]):s=s[:m.start()]+s[m.end():]
 s+=''.join('<p>'+x+'</p>' for x in paras)
 if stem=='sc-heat-extract':s=s.replace('unscoredobservation','unscored observation')
 f.write_text(s)
