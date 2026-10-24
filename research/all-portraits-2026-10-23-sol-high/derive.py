"""Offline derivations and explicit proposed amendments. No network, no site mutations.
Run: python3 research/all-portraits-2026-10-23-sol-high/derive.py
"""
from pathlib import Path
import json,csv,io,gzip,hashlib,html,collections,copy,decimal,zipfile,re
B=Path(__file__).resolve().parent
ROOT=B.parent.parent
BASE=json.loads((ROOT/'site/data/portraits.json').read_text())
D=decimal.Decimal

def read(stem):
 r=json.loads((B/'activity'/f'{stem}.json').read_text());p=B/r.get('stored_path',r['raw_path']);v=p.read_bytes()
 if p.suffix=='.gz':v=gzip.decompress(v)
 assert hashlib.sha256(v).hexdigest()==r['sha256'],stem
 return v

def source(stem,snapshot=None,pdf=False,period=None,scale=None):
 r=json.loads((B/'activity'/f'{stem}.json').read_text());out={'url':r['url'],'raw_path':r.get('stored_path',r['raw_path']),'raw_sha256':r['sha256'],'raw_encoding':r.get('storage_encoding','identity'),'captured_at':r['captured_at'],'period':period,'scale':scale}
 if 'stored_sha256' in r:out['stored_sha256']=r['stored_sha256']
 snap=snapshot or r.get('snapshot_path')
 if snap:
  out['snapshot_path']=snap
  if (B/snap).exists():out['snapshot_sha256']=hashlib.sha256((B/snap).read_bytes()).hexdigest()
 if pdf:out['pdf_path']=r['raw_path']
 return out

AM=[]; RESULTS={}; EXHIBITS=[]
def old(p,d,i):return next(x for x in next(a for a in BASE['portraits'] if a['slug']==p)['dimensions'] if x['slug']==d)['indicators'][i]
def amend(p,d,i,after,reason,sources,kind='replace'):
 before=copy.deepcopy(old(p,d,i)) if kind=='replace' else None
 payload=copy.deepcopy(before or {});payload.update(after)
 # Evidence in research records uses campaign-relative paths; exporter maps to public archives.
 if sources:
  s=sources[0];payload['evidence_path']=s.get('snapshot_path');payload['pdf_path']=s.get('pdf_path');payload['source_url']=s['url'];payload['evidence']={'snapshot_path':s.get('snapshot_path'),'captured_at':s['captured_at']}
  if s.get('pdf_path'):payload['evidence']['pdf_path']=s['pdf_path']
 aid=f'{p}:{d}:{i if kind=="replace" else "append"}'
 AM.append({'id':aid,'portrait':p,'dimension':d,'indicator_index':i,'kind':kind,'before':before,'after':payload,'field_diff':{k:{'before':(before or {}).get(k),'after':v} for k,v in payload.items() if (before or {}).get(k)!=v},'reason':reason,'source_support':sources,'review_required':True})

def obs(name,value,unit,year,geog,notes,source_name):
 return dict(name=name,value=value,unit=unit,year=year,target=None,level_pct=None,scoring=None,status='source-supported-observation',confidence='medium',geography=geog,geographic_scale='county' if geog=='county' else 'city' if geog=='city' else 'regional',notes=notes,source=source_name)
def scored(after,target,fn,ref,scale=None):
 scale=scale or abs(target);v=after['value'];level=round(((target-v) if fn=='higher_is_better' else (v-target))/scale*100,2)
 return {**after,'target':target,'level_pct':level,'status':'source-supported-draft','scoring':{'threshold_ref':ref,'function':fn,'inputs':{'value':v,'target':target,'scale':scale},'worked_math':f'({target} - {v}) / {scale} * 100 = {level}' if fn=='higher_is_better' else f'({v} - {target}) / {scale} * 100 = {level}'}}
def exhibit(stem,title,body):
 p=B/'calculations'/f'{stem}.html';p.write_text('<!doctype html><meta charset="utf-8"><title>'+html.escape(title)+'</title><style>body{font:20px/1.45 system-ui;max-width:1100px;margin:44px auto;color:#152638}table{border-collapse:collapse;width:100%;font-size:17px}td,th{border:1px solid #abc;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px}h1{font-size:32px}code{overflow-wrap:anywhere}</style><h1>'+html.escape(title)+'</h1><p>Researcher-generated faithful extract/derivation from archived source bytes. Original inputs, exact URLs and SHA-256 hashes are retained in this campaign. This exhibit is not a publisher-authored table.</p>'+body)
 EXHIBITS.append(['render','calculations/'+p.name,stem]);return 'evidence/'+stem+'.png'
def table(headers,rows):return '<table><tr>'+''.join('<th>'+html.escape(str(x))+'</th>' for x in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in r)+'</tr>' for r in rows)+'</table>'

# NYC PM2.5: exact citywide annual row, no borough averaging.
r=json.loads(read('nyc-pm25-2024'));assert len(r)==1 and r[0]['time_period']=='2024' and r[0]['geo_type_name']=='Citywide';v=float(r[0]['data_value']);assert v==6.255051193
snap=exhibit('nyc-pm25-extract','NYC annual mean PM2.5 — 2024','<pre>'+html.escape(json.dumps(r,indent=2))+'</pre><p>Exact official citywide row; no new averaging. Target remains5µg/m³.</p>')
a=copy.deepcopy(old('nyc','air-pollution',0));a.update(notes='Exact DOHMH/NYCCAS citywide 2024 annual mean row archived. This closes an evidence-capture outage; the value and target are unchanged.',status='source-supported-draft')
amend('nyc','air-pollution',0,a,'Missing source exhibit restored.',[source('nyc-pm25-2024',snap,period='calendar2024',scale='city')])

# Bronx food: report year is NOT data year.
s=source('bronx-food-2024-report','evidence/bronx-food-report-page4.png',True,'2022','county')
amend('bronx','food',0,{'status':'source-supported-draft','notes':'Official NYC Food by the Numbers2024 PDF physicalpage4 identifies BronxCounty290,990 people /20.2% food insecure, explicitly asof2022. Report publication year is not the observation year. This restores missing evidence; it does not establish a2024 prevalence.'},'Restore the exact archived table supporting the already-published2022 observation.',[s])

# Water: genuinely conflicting compliance constructs; annual State report does not void historical federal TT.
water_sources=[source('nyc-state-water-2025',period='calendar2025 annual violations entered',scale='NYCsystem'),source('nyc-water-2025-mirror','evidence/nyc-water2025-page3.png',True,'calendar2025', 'NYCsystem'),source('nyc-echo-current',period='currentthrough2026Q2; historicalstart2017-02-01',scale='NYCsystem')]
water_note=('NYSDOH annual2025 report says no violations were entered inSDWIS/State for2025; DEP2025 report says all drinking-water standards were met. EPA ECHO simultaneously carries historical TT violation#20170201 (LongTerm2 Enhanced Surface Water Treatment Rule), beginning2017-02-01, statusAddressed via2019-05-15 federal consent decree, with recentquarters Violation-Addressed. An annual newly-entered-violation measure and an unresolved/addressed historical federal compliance measure are different constructs. Neither proves zero residents had safe tap water. A single coherent annual-versus-current definition must be dispositioned before scoring the configured no-health-based-violations population metric. Citysystem context applies to boroughs, not a separate borough sampling prevalence.')
for p in ['nyc','manhattan','brooklyn','queens','bronx','staten-island']:
 amend(p,'water-sanitation',0,dict(value=None,year=None,level_pct=None,scoring=None,status='uncertain',confidence='low',geography='NYC drinking-water system — shared citywide context',geographic_scale='city',notes=water_note,source='NYSDOH2025 annual compliance report; DEP2025 drinking-water report; EPA ECHO current system record'),'Withhold conflicting/undefined numeric score pending annual/current compliance construct review.',water_sources)

# Waste: exact raw monthly coverage; January omission is independently reproducible.
cy=json.loads(read('dsny-raw-cy'));fy=json.loads(read('dsny-raw-fy'))
assert len(cy)==1416 and len(fy)==1416
summary=[]
for scope,rows in [('CY',cy),('FY',fy)]:
 for borough in ['Bronx','Brooklyn','Manhattan','Queens','Staten Island','CITY']:
  vals=[]
  for year in [2005,2025]:
   sel=[r for r in rows if (r['borough']==borough or borough=='CITY') and (int(r['month'][:4]) if scope=='CY' else int(r['month'][:4])+(int(r['month'][-2:])>=7))==year]
   identities=[(r['month'],r['borough'],r['communitydistrict']) for r in sel];assert len(identities)==len(set(identities))
   assert len(set(r['month'] for r in sel))==12
   vals.append({'tons':str(sum(D(r['refusetonscollected']) for r in sel)),'rows':len(sel),'months':sorted(set(r['month'] for r in sel)),'districts':len(set((r['borough'],r['communitydistrict']) for r in sel))})
  reduction=(D(vals[0]['tons'])-D(vals[1]['tons']))/D(vals[0]['tons'])*100
  summary.append({'scope':scope,'borough':borough,'baseline':vals[0],'current':vals[1],'reduction_pct':float(reduction)})
RESULTS['waste']=summary
snap=exhibit('nyc-waste-extract','DSNY refuse collected — full-year coverage',table(['Period','Place','2005tons','2025tons','Reduction%','Rows each year'],[(r['scope'],r['borough'],r['baseline']['tons'],r['current']['tons'],round(r['reduction_pct'],6),f"{r['baseline']['rows']}/{r['current']['rows']}") for r in summary])+'<p>Every year has12months and unique month/borough/communitydistrict identities. Bronx has12districts×12months=144rows. Prior Bronx132rows omittedJanuary. Full2005 minusJan43,355.90=513,421.85; full2025 minusJan42,199.80=478,703.47, exactly reproducing the prior erroneous inputs. Refuse-collected tonnage is not proof of final landfill disposal: landfill/combustion destinations and non-DSNY waste are not included in this dataset.</p>')
for p,scope,place,i in [('nyc','FY','CITY',1),('bronx','CY','Bronx',1)]:
 r=next(r for r in summary if r['scope']==scope and r['borough']==place);v=round(r['reduction_pct'],2)
 after=obs('Reduction in DSNY-collected refuse tonnage vs2005 (disposal proxy)',v,'% reduction',2025,'city' if p=='nyc' else 'county',f"{scope}2005:{r['baseline']['tons']}tons; {scope}2025:{r['current']['tons']}tons. {r['baseline']['rows']}/{r['current']['rows']} unique district-month records;12months each. Fiscalyears runJul–Jun; calendaryearsJan–Dec. The configured landfill-bound metric is not exact: DSNY refuse collected is a disposal proxy and excludes commercial/private collection. Existing90% target is retained only as context; no proxy score asserted. Original Bronx calculation omittedJanuary; full-year reduction{v}%.",'NYC Department of Sanitation — Monthly Tonnage Data')
 amend(p,'chemical-pollution',i,after,'Restore missing archives and exact coverage; expose the refuse-collected versus landfill-disposed construct.',[source('dsny-raw-fy' if scope=='FY' else 'dsny-raw-cy',snap,period=f'{scope}2005 vs{scope}2025',scale='city' if p=='nyc' else 'county'),source('dsny-metadata')])

# GHG exact totals and dated population vintages; do not pretend a regional observation is borough-specific.
ghg=json.loads(read('nyc-ghg-full'));total=[r for r in ghg if r.get('inventory_type')=='Total'];assert len(total)==1;total=total[0]
emission=D(total['cy_2024_tco2e']);baseline=D(total['cy_2005_tco2e_100_yr_gwp']);assert emission==D('47944551.47') and baseline==D('64139720.6')
geo_codes={'Bronx':'005','Brooklyn':'047','Manhattan':'061','Queens':'081','Staten Island':'085'}
pops={}
for vintage in [2024,2025]:
 rows=list(csv.DictReader(io.StringIO(read(f'census-county-pop-v{vintage}').decode('cp1252'))));sel=[r for r in rows if r['STATE']=='36' and r['COUNTY'] in geo_codes.values()];assert len(sel)==5
 pops[vintage]={r['COUNTY']:int(r['POPESTIMATE2024']) for r in sel}
RESULTS['population_vintages_2024']={str(v):{'counties':r,'citysum':sum(r.values())} for v,r in pops.items()}
RESULTS['ghg']={'emissions_2024':str(emission),'baseline_2005':str(baseline),'reduction_pct':float((baseline-emission)/baseline*100),'percapita_v2024':float(emission/sum(pops[2024].values())),'percapita_v2025':float(emission/sum(pops[2025].values()))}
snap=exhibit('nyc-ghg-extract','NYC community emissions and population vintage',table(['CY2005total tCO2e','CY2024total tCO2e','Reduction%'],[(baseline,emission,RESULTS['ghg']['reduction_pct'])])+table(['Population vintage','CY2024population','tCO2e/resident'],[(v,sum(pops[v].values()),float(emission/sum(pops[v].values()))) for v in pops])+'<p>Use NYCcommunity inventory total,100yearGWP. Borough displays are citywide regional proxies. Both5.66(Vintage2024) and5.58(Vintage2025) arise from defensible but different Census revisions; this is disclosed rather than silently harmonized. Raw fullinventory85rows, exact Total row, and all five same-vintage county population rows are archived.</p>')
for i in [0,1]:
 a=copy.deepcopy(old('bronx','climate-change',i));a.update(status='source-supported-draft',geography='NYC citywide regional proxy — not Bronx emissions',notes='Exact citywide inventory totals and the original Census Vintage2024 denominator8,478,072 independently reproduced from archived primary bytes. The newer Vintage2025 revises2024population to8,596,825, explaining alternate5.58 city estimate. Borough value retained with its original vintage; not a Bronx-specific inventory.')
 amend('bronx','climate-change',i,a,'Restore missing numeric evidence with the original population vintage explicit.',[source('nyc-ghg-full',snap,period='CY2024;2005baseline',scale='citywide regional proxy'),source('census-county-pop-v2024',period='July1,2024;Vintage2024',scale='fiveNYCcounties')])
amend('bronx','climate-change',2,{'status':'source-supported-draft','notes':'UrbanGreenCouncil January2026 page uses2024 benchmarking data:43% of coveredbuildings meet2030limits, so57% are above. This is modeled future-cap exposure from2024 energy use, not a2024 legal violation rate. Citywide observation carried as regional proxy.'},'Restore missing source exhibit and preserve estimate/projection type.',[source('nyc-ll97',period='2024benchmarking;2030caps',scale='NYC citywide regional proxy')])

# TRI: quantified FormR only; missing FormA quantities are not zero measurements.
tri=json.loads(read('nyc-tri-2024'));nyc_counties=['BRONX','KINGS','NEW YORK','QUEENS','RICHMOND'];sel=[r for r in tri if r['county'] in nyc_counties];excluded=[r for r in sel if r['county']=='NEW YORK' and r['city']=='JAMESTOWN'];assert len(excluded)==2;sel=[r for r in sel if r not in excluded]
tri_summary=[]
for county,code in [('BRONX','005'),('KINGS','047'),('NEW YORK','061'),('QUEENS','081'),('RICHMOND','085'),('CITY',None)]:
 rs=[r for r in sel if county=='CITY' or r['county']==county];forms=collections.Counter(r['form type'] for r in rs);quant=sum(D(str(r['on-site release total'])) for r in rs if r['form type']=='R');pop=sum(pops[2025].values()) if code is None else pops[2025][code]
 tri_summary.append({'county':county,'rows':len(rs),'forms':dict(forms),'quantified_lbs':str(quant),'population2024_vintage2025':pop,'quantified_lbs_per_resident':float(quant/pop)})
RESULTS['tri']=tri_summary
snap=exhibit('nyc-tri-extract','Quantified TRI FormR onsite releases — reportingyear2024',table(['County','Rows','Formcounts','Quantified onsite lbs','2024population(V2025)','lb/resident'],[(r['county'],r['rows'],r['forms'],r['quantified_lbs'],r['population2024_vintage2025'],r['quantified_lbs_per_resident']) for r in tri_summary])+'<p>TRI basicfile has1509NYrows. Countyfield NEWYORK includes two erroneous Jamestownfacility records(10lb each), outsideManhattan; excluded by documented facilitycity/coordinates. FormA certifications do not quantify releases; source export zero placeholders are not measurements of zero. QuantifiedFormR totals exclude those unknown quantities. This proxy does not measure every pollutant, facility, toxic exposure or total true releases.</p>')
for p,county in [('nyc','CITY'),('bronx','BRONX')]:
 r=next(r for r in tri_summary if r['county']==county);after=obs('Quantified TRI FormR on-site releases per capita',r['quantified_lbs_per_resident'],'lb per resident per year',2024,'city' if p=='nyc' else 'county',f"EPA reportingyear2024 quantifiedFormR releases{r['quantified_lbs']}lb / July1,2024 CensusVintage2025 population{r['population2024_vintage2025']}. {r['forms'].get('A',0)}FormA records have unquantified releases, not measured zeros. The configured totalTRI-release metric therefore remains incompletely quantified. No score asserted for this qualified observed lowerbound. Reporting thresholds and coveredindustries restrictTRI coverage.",'US EPA TRI BasicDataFiles2024; US Census county populationVintage2025')
 amend(p,'chemical-pollution',0,after,'Correct denominator provenance and distinguish quantified releases from FormA missing quantities.',[source('nyc-tri-2024',snap,period='reportingyear2024',scale='city' if p=='nyc' else 'county'),source('census-county-pop-v2025',period='July1,2024;Vintage2025',scale='county')])

# Conservation report is explicitly land AND water: do not score as protected land.
areas=[30863,52820,20528,80102,37869];protected=[5646,12804,2735,14071,8118];share=sum(protected)/sum(areas)*100
RESULTS['nyc_conservation']={'protected_land_and_water_acres':sum(protected),'land_and_water_area_acres':sum(areas),'percent':share,'land_only_share':None}
snap=exhibit('nyc-conservation-extract','NYC protected land AND water — report2023',table(['County','Total land+water acres','Protected land+water acres'],list(zip(['Bronx','Kings','NewYork','Queens','Richmond'],areas,protected)))+f'<p>Sum{sum(protected):,}/{sum(areas):,}×100={share:.8f}%. Source countyheadings explicitly say Protected Land and Water Area. A land-only numerator/denominator cannot be recovered from these aggregate tables;19.5% must not be scored as percent of jurisdiction LAND.</p>')
a=obs('Land and water under reported conservation protection',round(share,1),'% of total land and water area',2023,'city','Report county tables include land ANDwater;19.5% is numerically reproducible for that scope. The framework land-only measure remains a gap and30% land-only target is not applied. Mixed protectioncategories do not independently establish equivalent biodiversityquality.','Protect the Adirondacks — NYSCounties30by30 report2023')
amend('nyc','biodiversity-loss',0,a,'Archive the report and correct the land/water denominator construct.',[source('nyc-protected-2023',snap,True,'2023','fiveNYCcounties')])

# NYC ocean: exact paper Table1; source clearly reports summer bottomwater westernLIS, not citywide annual surfaceocean.
raw=read('nyc-ocean-study').decode();match=re.search(r'<table\b[^>]*>.*?1\.09.*?</table>',raw,re.S);assert match
clean=html.unescape(re.sub('<[^>]+>',' ',match.group()));assert '2022' in clean
snap=exhibit('nyc-ocean-extract','Western Long Island Sound aragonite — Table1',match.group()+'<p>Barrett etal(2024), Table1:2022July–September averagebottomwater Ωar1.09±0.00, westernLongIslandSound westoflongitude−73°. This is aseasonal bottomwater regionalcontext observation, not aNYCannualsurfaceoceanmean or boroughspecificreading.</p>')
a=copy.deepcopy(old('bronx','ocean-acidification',0));a.update(name='Western Long Island Sound summertime bottom-water aragonite saturation (regional proxy)',status='source-supported-draft',geography='Western Long Island Sound regional proxy — not Bronx waters alone',notes='SourceTable1 exactly supports2022July–September westernLISbottomwater Ωar1.09±0.00. This is aseasonal bottomwater regionalproxy permitted by inheritedregional scale, not aNYCannualsurfaceoceanmean. TargetΩ3 retained from existing framework; depth/season/ecosystem comparability remains a scientific limitation.')
amend('bronx','ocean-acidification',0,a,'Restore failed sourcecapture and make seasonal/depth/geographic proxy explicit.',[source('nyc-ocean-study',snap,period='July–September2022',scale='westernLongIslandSound regional')])
# A new Staten observation fills empty evidence without pretending a locationmeasurement or assigning a proxy score.
a=obs('Western Long Island Sound summertime bottom-water aragonite saturation (regional context)',1.09,'Ωaragonite',2022,'Western Long Island Sound regional context — not Staten Island coastal waters','Table1summer2022bottomwater mean1.09±0.00. No StatenIsland-specific observation established. This fills regionalcontext only; no score is asserted until reviewer accepts geography/depth/season comparability.','Barrett etal2024 FrontiersinMarineScience11:1398087')
amend('staten-island','ocean-acidification',0,a,'Empty dimension: archive nearest defensible regionalcontext and retain its limitations.',[source('nyc-ocean-study',snap,period='July–September2022',scale='westernLongIslandSound regional')],kind='append')

# Official Census detailed tables, exact place/county geographies, no proxies as local citydata.
geos={'santa-cruz':'1600000US0669112','watsonville':'1600000US0683668','santa-cruz-county':'0500000US06087'}
tables={}
for stem in ['acs5-gini2024','acs1-gini2024','acs5-broadband2024','acs5-poverty2024']:
 rows=csv.DictReader(io.StringIO(read(stem).decode()),delimiter='|');tables[stem]={r['GEO_ID']:r for r in rows if r['GEO_ID'] in geos.values()}
RESULTS['census_selected_rows']=tables
snap=exhibit('sc-census-extract','Santa Cruz and Watsonville — official ACS2024 tables','<p>Cityperiod2020–2024fiveyear estimates. CountyGiniperiod2024oneyear. Geographic IDs identify legalcitylimits/county, not urbanareas orPUMAs. Statisticalestimates have90%MOEs; no combinedratioMOE wascalculated.</p>'+''.join('<h2>'+st+'</h2><pre>'+html.escape(json.dumps(rs,indent=2))+'</pre>' for st,rs in tables.items()))
for p,geo in geos.items():
 scale='county' if p=='santa-cruz-county' else 'city'
 # Gini replaces vaguely scoped county approximations with exact configuredlocal boundary.
 st='acs1-gini2024' if scale=='county' else 'acs5-gini2024';row=tables[st][geo];v=float(row['B19083_E001']);moe=float(row['B19083_M001']);period='2024ACS1year' if scale=='county' else '2020–2024ACS5year'
 a=obs('Income inequality (household Gini index)',v,'Gini0–1',2024,scale,f'OfficialB19083_E001={v};90%MOE±{moe}. {period}, geography{geo}. Replaces earlier unclear countyproxy/approximation. Legacytarget was prose and differs byportrait; no new numericthreshold approved here. Watsonville environmentaljustice context is distinct from householdincomeGini.','US Census Bureau ACS2024 DetailedTableB19083')
 amend(p,'social-equity',0,a,'Replace unspecified/approximate geography with exact primary ACSGini and explicitperiod.',[source(st,snap,period=period,scale=scale),source('acs5-shells2024')])
 if scale=='city':
  row=tables['acs5-poverty2024'][geo];num=int(row['C17002_E002'])+int(row['C17002_E003']);den=int(row['C17002_E001']);v=round(num/den*100,1)
  a=obs('Persons below the poverty line',v,'% of persons with poverty status determined',2024,scale,f'2020–2024ACS5yearC17002:under0.50+0.50–0.99income/povertyratios ({num}) /povertyuniverse({den})×100={num/den*100:.8f}%. Populationforwhompovertydetermined excludescertaininstitutional/groupquarters persons; notallresidentpopulation. PrimaryCSV estimates/MOEs retained. NocombinedpercentageMOEcalculated. Legacythresholdprose notnewlyreconfigured.','US Census Bureau ACS2024DetailedTableC17002')
  amend(p,'income-work',0,a,'Refresh stale/combined poverty measurement using primary exact cityperiod.',[source('acs5-poverty2024',snap,period='2020–2024ACS5year',scale='city'),source('acs5-shells2024')])
 # County uses official1yrcomparison; cities use5yrdetailedtable.
 if scale=='city':
  row=tables['acs5-broadband2024'][geo];num=int(row['B28002_E004']);den=int(row['B28002_E001']);v=round(num/den*100,1);st='acs5-broadband2024';period='2020–2024ACS5year';note=f'B28002_E004BroadbandofANYtype{num}/B28002_E001households{den}×100={num/den*100:.8f}%.'
 else:
  rows=list(csv.DictReader(io.StringIO(read('broadband-2024-comparison').decode('cp1252'))));r=next(r for r in rows if r['GEOID']==geo);v=float(r['ESTIMATE']);st='broadband-2024-comparison';period='2024ACS1year';note=f"GCT2801estimate{v}%;90%MOE{r['MG_ERROR']}."
 a=obs('Households with broadband internet of any type',v,'% of households',2024,scale,f'{period}. {note} Includescellular-only subscriptions; notfixedcable/fiber/DSL. Doesnotmeasureprice,quality,speed orcommuting. Legacycombinedmobilityclaims notsubstantiatedbythisinternettable.','US Census Bureau ACS2024B28002/GCT2801')
 amend(p,'networks',0,a,'Replace vague digitaldivide/countclaims with exact typed subscriptionmeasure and retainedscope limitations.',[source(st,snap,period=period,scale=scale),source('acs5-shells2024')])

# Broadband metric drift: retain fixed values, correct names without pretending these areANYbroadband.
for p in ['bronx','staten-island']:
 a=copy.deepcopy(old(p,'networks',0));a.update(name='Households with fixed broadband (cable, fiber optic, or DSL)',notes='Prior63.3%(Bronx)/76.5%(StatenIsland) figures refer to2023fixedbroadband, notbroadbandofANYtype. Official2024GCT2801 reportsANYbroadband88.9%/94.0%, a differentconstruct andyear. Namecorrected; originalfixedvalue retained. SourceoriginalOSC archive remainsloadbearing.',status='source-supported-draft')
 # Originalpublicarchive belongs tobaseline, so binding isexplicitlyretainedratherthannewsourcecapture.
 orig=old(p,'networks',0);snap_old=orig['evidence_path'];pdf_old=orig.get('pdf_path');archive=ROOT/'site'/snap_old
 support={'url':orig['source_url'],'snapshot_path':'../../site/'+snap_old,'snapshot_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'period':'2023ACS1yearfixedbroadband','scale':'county','captured_at':orig['evidence']['captured_at'],'raw_path':'../../site/'+pdf_old,'raw_sha256':hashlib.sha256((ROOT/'site'/pdf_old).read_bytes()).hexdigest(),'pdf_path':'../../site/'+pdf_old}
 amend(p,'networks',0,a,'Correct fixed-versus-anybroadband label; no invented improvement from incomparable measures.',[support])

# PIT exact jurisdictiontable, withanactualsourcearithmeticconflictretained.
pit_source=source('sc-pit-2026-full','evidence/sc-pit-2026-page13.png',True,'January28–29,2026PIT','city/countyjurisdictiontable')
for p,value,scale in [('santa-cruz',1024,'city'),('watsonville',303,'city'),('santa-cruz-county',1648,'county')]:
 note=('2026PITCountandSurveyReport p13. CitySantaCruzpublishedtotal1024 conflictswith789unsheltered+234sheltered=1023; incorp subtotal1390 agreeswith1023, not1024. Do not silently repair source. ' if p=='santa-cruz' else '2026PITCountandSurveyReport p13; Watsonville179unsheltered+124sheltered=303; county1290unsheltered+358sheltered=1648. ')
 note+='January29,2026streetcount and January28shelteroccupancy; asingle-nightsnapshot, notannualpersonsserved. NewlyincludedHMISsafeparking/sleeping added124CitySantaCruz/2Watsonville relative topriorpractice; rawyear-over-yeardifferences arenotmethodologicallyconstant. Baseline1850wasCOUNTY2024, notCitySantaCruz. Costburdenandspecificpercapitatarget areseparatemeasures; no countscorederivedfromlegacycombinedprosetarget.'
 a=obs('People experiencing homelessness on the PIT count night',value,'persons (one-night PIT estimate)',2026,scale,note,'Santa Cruz County Housing for Health Partnership / AppliedSurveyResearch2026PITreport')
 if p=='santa-cruz':a.update(status='uncertain',confidence='low')
 amend(p,'housing',0,a,'Correct county-as-city boundary error and replace vague homelessnessclaim with current jurisdiction-specific count.',[pit_source,source('sc-pit-2026-release',pdf=True,period='January29,2026',scale='county')])

# Heat proposed only after explicitprofilebinding; reuseoriginalCDCbyteswithoutclaimingnewdownload.
archive=ROOT/'research/carmel-monterey-2026-10-23-sol-medium/calculations/extreme-heat/raw/EJI_2024_California_CSV.zip'
with zipfile.ZipFile(archive) as z:rows=list(csv.DictReader(io.StringIO(z.read('EJI_2024_California.csv').decode('utf-8-sig'))))
rs=sorted([r for r in rows if r['STATEFP']=='06' and r['COUNTYFP']=='087'],key=lambda r:r['GEOID']);assert len(rs)==69;assert len(set(r['GEOID'] for r in rs))==69;assert all(float(r['E_NEHD'])>=0 and float(r['E_TOTPOP'])>=0 for r in rs)
coverage=json.loads(read('sc-census2020-tract-coverage-correct'));census={r['attributes']['GEOID']:r['attributes'] for r in coverage['features']};missing=set(census)-{r['GEOID'] for r in rs};assert not {r['GEOID'] for r in rs}-set(census);assert all(census[k]['POP100']==0 and census[k]['AREALAND']==0 for k in missing)
num=sum(float(r['E_TOTPOP'])*float(r['E_NEHD']) for r in rs);den=sum(float(r['E_TOTPOP']) for r in rs);value=num/den
RESULTS['heat']={'tractcount':len(rs),'census2020tractcount':len(census),'omitted_zero_population_water_tracts':sorted(missing),'weighted_days_population_sum':num,'population_weight_sum':den,'value':value,'year':2022,'period':'2018–2022','source_sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
with (B/'calculations/sc-heat-inputs.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['GEOID','E_TOTPOP','E_NEHD']);w.writerows((r['GEOID'],r['E_TOTPOP'],r['E_NEHD']) for r in rs)
snap=exhibit('sc-heat-extract','Santa Cruz County extreme heat exposure — proposed unscoredobservation',f'<p>Resident-weighted2018–2022mean oftractannualextremeheatdays fromCDC EJI2024. Locally95th-percentile maximumtemperaturedefinition; notanabsoluteheat-indexthreshold, simultaneouscountywideevents orfutureprojection.</p><p>{num}/{den}={value:.10f}days/year across69EJItracts. Census2020tractcoverage:{len(census)}; omittedIDs{html.escape(str(sorted(missing)))}allhave0population,0landarea. Noinhabitedtractomissionfound.</p><p>No defensible safeannual-daytargetestablished. Target,scoreandwedge mustremainnull. CitySantaCruzandWatsonvillewouldexplicitlyshowcountycontext, nevercitylimitmeasurements. Profilemustexplicitlyreplacethelegacyozonedimensiononlyforthese3portraits; archivedozoneworkremainsintact.</p>')
heat_support={'url':'https://eji.cdc.gov/Documents/Data/2024/2024_CSV/EJI_2024_California_CSV.zip','raw_path':'../carmel-monterey-2026-10-23-sol-medium/calculations/extreme-heat/raw/EJI_2024_California_CSV.zip','raw_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'snapshot_path':snap,'captured_at':None,'period':'2018–2022','scale':'county','reuse_note':'Originalarchivefrompriorcampaign; no newdownloadclaimed. Newofflinecountyextraction/coveragequeryinthehighcampaign.'}
for p in geos:
 a=obs('Extreme heat exposure',value,'population-weighted mean days/year',2022,'county' if p=='santa-cruz-county' else 'Santa Cruz County proxy — not city limits','CDC EJI2024tractE_NEHD mean2018–2022, weightedbyE_TOTPOP2018–2022ACS. No safeannualdaytargetdefined; unscored. This replacesglobalozoneonlyifexplicitlocal-extreme-heat-v1profilecontractisapprovedforSCtrio. Countycontextmustnotbeinterpretedaslocalcityexposure.','CDC/ATSDR EnvironmentalJusticeIndex2024')
 amend(p,'ozone-layer-depletion',0,a,'Userrequestedlocalheatfocus; explicitdimension/profiledecisionrequiredbeforeintegration.',[heat_support,source('sc-census2020-tract-coverage-correct')],kind='replace')
 AM[-1]['replacement_dimension_slug']='extreme-heat';AM[-1]['required_profile']='local-extreme-heat-v1'
 # All3needprofile,notjustlastrecord
 for a0 in AM:
  if a0['portrait']==p and a0['dimension']=='ozone-layer-depletion':a0['replacement_dimension_slug']='extreme-heat';a0['required_profile']='local-extreme-heat-v1'

(B/'calculations/results.json').write_text(json.dumps(RESULTS,indent=2)+'\n')
(B/'render-jobs.json').write_text(json.dumps(EXHIBITS,indent=2)+'\n')
(B/'findings/amendments.json').write_text(json.dumps({'schema_version':1,'baseline_snapshot_sha256':hashlib.sha256((ROOT/'site/data/portraits.json').read_bytes()).hexdigest(),'research_model':'gpt-6.1-sol','reasoning_effort':'high','amendments':AM},indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'amendment_count':len(AM),'portraits':sorted(set(a['portrait'] for a in AM)),'exhibits':len(EXHIBITS),'result_keys':list(RESULTS)},indent=2))
