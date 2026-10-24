from pathlib import Path
import json,hashlib,csv,datetime,collections
B=Path(__file__).resolve().parent;ROOT=B.parent.parent
# Exact gap records are retained, with honest new-session scope and extraction dependencies.
dispositions=[]
for portrait in ['carmel','monterey-county']:
 for dimension in ['water-sanitation','energy','nitrogen-phosphorus-loading','freshwater-withdrawals']+(['climate-change'] if portrait=='monterey-county' else []):
  f=ROOT/'research/carmel-monterey-2026-10-23-sol-medium'/portrait/'findings'/f'{dimension}.json';old=json.load(open(f))
  status='needs-extraction' if dimension in ['water-sanitation','nitrogen-phosphorus-loading','freshwater-withdrawals'] else 'gap'
  next_steps={
   'water-sanitation':'A full annual health-based violation numerator must be joined to a deduplicated, same-period community-system service-population denominator and a defensible population allocation to the city/county. Principal county, counties-served labels and current ECHO HealthFlag alone do not supply that allocation. For Carmel, establish complete city coverage by the relevant system before deriving a city percentage.',
   'energy':'Obtain a recent household-level distribution or publisher-produced median for low-income households within exact city/county boundaries. DOE LEAD cohort averages, CPUC average burden and nearby metro medians cannot identify the configured household median.',
   'nitrogen-phosphorus-loading':'Archive recent sample-level well results with analyte/unit harmonization, sampling dates, coordinates, detection limits and a predeclared representative jurisdiction statistic. Selected coastal wells, subbasins, voluntary exceedance counts and treated drinking-water results cannot become a county groundwater concentration.',
   'freshwater-withdrawals':'Obtain annual residential water deliveries and a matching served-resident denominator for Carmel city, or a complete deduplicated county supplier/self-supply inventory for the accepted county measure. District R-GPCD and mixed-year city account averages are not city/county resident R-GPCD.',
   'climate-change':'Obtain observed community inventories for all incorporated and unincorporated county areas using compatible methods and a common year2021ornewer, or an accepted recent regional community inventory. Do not substitute interpolated2022 baselines, stale2019/2020 inventories, a municipal operations inventory, or territorial source estimates for the configured community accounting boundary.'}[dimension]
  dispositions.append({'portrait':portrait,'dimension':dimension,'status':status,'baseline_finding_path':str(f.relative_to(ROOT)),'baseline_finding_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'baseline_finding':old,'high_session_disposition':'Retain the documented gap. No new compliant number was established. This round audited scope and prior exclusions; it does not claim a new exhaustive search of every source.','required_next_evidence':next_steps,'new_search_context':'Exact fresh Carmel utility/Monterey inventory queries are logged under turn452 and turn443. Results were administrative expenditure/RHNA context or stale inventory descriptions, not a compliant measurement.'})
(B/'findings/gap-dispositions.json').write_text(json.dumps({'schema_version':1,'scope':'All9 currently explicit Carmel/Monterey gaps; no guesses and no public changes proposed','dispositions':dispositions},indent=2,ensure_ascii=False)+'\n')
# All11 have a tractable status inventory; old legacy defects remain candidates, not silently cleared.
inv=json.load(open(B/'inventory.json'));batch=json.load(open(B/'findings/amendments.json'));matches={(a['portrait'],a['dimension'],a['indicator_index']):a['id'] for a in batch['amendments']}
for p in inv['all_11_inventory']:
 for issue in p['issues']:
  key=(p['portrait'],issue['dimension'],issue.get('indicator_index',0));issue['campaign_disposition']='proposed-amendment-awaiting-independent-review' if key in matches else 'remaining-candidate-no-new-compliant-measure-established';issue['amendment_id']=matches.get(key)
(B/'inventory-dispositions.json').write_text(json.dumps(inv,indent=2,ensure_ascii=False)+'\n')
# Inherited dated price assumptions, one shared researcher allocation across all11 exactlyonce.
rates=json.load(open(ROOT/'research/carmel-monterey-2026-10-23-sol-medium/pricing.json'))
searchproxy=19*10/1000
scenarios=[]
for name,input_tokens,output_tokens in [('low',500000,30000),('base',2000000,80000),('high',10000000,250000)]:
 token=input_tokens/1e6*2+output_tokens/1e6*10
 scenarios.append({'scenario':name,'assumed_shared_session_input_tokens':input_tokens,'assumed_shared_session_output_tokens_including_reasoning':output_tokens,'standard_token_usd':round(token,2),'fast_token_usd':round(token*2,2),'web_call_proxy_usd':round(searchproxy,2),'standard_total_usd':round(token+searchproxy,2),'fast_total_usd':round(token*2+searchproxy,2)})
ledger={'campaign':'all-portraits-2026-10-23-sol-high','model':'gpt-6.1-sol','reasoning_effort':'high','budget_usd':None,'actual_tokens':None,'actual_billed_usd':None,'pricing_assumptions_inherited_from':'research/carmel-monterey-2026-10-23-sol-medium/pricing.json','pricing_checked_date_in_prior_campaign':rates['pricing_checked_date'],'rates':rates['rates'],'search_rate_assumption_per1000_calls':10,'search_price_url':rates['web_search_pricing_source'],'allocation':'One shared researcher role/session spanning all11 portraits, counted once. Not11copies of the same work. Independent reviewer activity excluded until actually performed.','assumptions_note':'Uses the same low/base/high token quantities as the previous ledger, reinterpreted explicitly as TOTAL shared-session assumptions rather than per-portrait quantities. These are sensitivity scenarios, not measured usage, limits or invoices. High effort does not imply a discount or fixed token quantity. The19 web calls are only an assumed billable-search proxy; browser network requests are not separately priced. Price rates are dated inherited inputs, not newly verified live rates.','scenarios':scenarios}
(B/'cost-sensitivity.json').write_text(json.dumps(ledger,indent=2)+'\n')
with (B/'cost-sensitivity.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(scenarios[0]));w.writeheader();w.writerows(scenarios)
(B/'README.txt').write_text('''All-portrait research campaign — GPT-6.1 Sol, high effort

Scope: all 11 public portraits were inventoried. Batch1 contains34 proposed amendments across9portraits; supplemental housing adds2 observations for Carmel/Monterey. None is independently reviewed or human approved merely because it is present here. Root owns integration and all GitHub operations.

Review files:
- findings/amendments.json: frozen34claim batch. Exact before/after records and full source archive SHA256 bindings.
- findings/supplemental-housing.json:2 independently addressable primary Census supplements; a related at-least30% observation is explicitly unscored while strict-over30% remains unresolved.
- findings/gap-dispositions.json:9 retained explicit Carmel/Monterey gaps, source trails and exact next-evidence requirements. No exhaustive new search is claimed for these retained gaps.
- inventory.json: original complete11portrait issue inventory.
- inventory-dispositions.json: issue-level linkage to new proposals, with remaining work explicit.
- evidence-manifest.json: frozen41file batch1 evidence binding. Supplemental evidence uses a separate manifest and does not mutate this file.
- searches/web-queries.json + activity/: exact new queries and network/capture successes/failures.
- cost-sensitivity.json/CSV: explicitly assumed token scenarios; actual tokens/billed dollars remain null.

Reproduction:
1. python3 derive.py — offline exact source extraction and draft34amendments.
2. python3 polish.py — final human-readable notes/exhibit explanations.
3. python3 run-jobs.py render-jobs.json — installed browser only; render8faithful numerical extracts.
4. python3 finalize.py — assert all referenced source hashes, bind snapshots and write per-claim files.
The complete sequence reproduces semantic findings; browser screenshots/timestamps are new evidence artifacts on rerender, so byte hashes then change and independent review must bind the new files. Do not rerun these commands over the frozen reviewed batch as a routine check.
Supplement: python3 supplement-housing.py; render calculations/rentburden-extract.html using capture.mjs. The official large national DAT files are losslessly gzip-compressed; source SHA256 refers to decompressed publisher bytes and stored SHA256 separately binds the gzip file.

Scientific review priorities:
- NYC water: State annual newly-entered violations and an addressed historical federal treatment-technique record conflict as indicator constructs. Withdrawal to uncertainty is not proof either old endpoint value was categorically false.
- Bronx waste: omitted January is proven by exact reproduction of prior totals. DSNY refuse collection is still a disposal proxy, not a measured final-landfill series.
- NYC conservation: the cited19.5% includes landANDwater, not justland. Reframed observation remains unscored.
- TRI: FormA is unquantified, notzero. Quantified FormR plus same-year Census Vintage2025 population is explicitly qualified.
- Santa Cruz city PIT: the source itself says1024 but components789+234 sum1023. Do not silently repair; keep uncertainty. County1648 and Watsonville303 arithmetic is consistent.
- Heat: county resident-weighted2018–2022 exposure, notcity observations; null target/score. An explicit local-extreme-heat-v1 profile decision is required for the3SantaCruz portraits.
- Census cityperiods2020–2024fiveyear versus county2024oneyear are explicit. No combinedratioMOE fabricated.

Remaining work is retained rather than reported as closed: many legacy SantaCruz narrative/multi-metric values lack compliant numeric definitions or archives; Carmel/Monterey source-period, householdmedian, groundwatercoverage and water-service allocation gaps remain. Watsonville water2024 PDF is readable through web search but direct archive failed via TLS/browser; source suggests the legacy nitrate-contaminated characterization is too broad, but no accepted replacement is fabricated.
''')
print(json.dumps({'gap_dispositions':len(dispositions),'cost_scenarios':scenarios},indent=2))
