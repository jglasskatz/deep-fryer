"""Read-only independent checks. Writes only this review's result file."""
from pathlib import Path
import collections, csv, gzip, hashlib, io, json, re, subprocess, zipfile
from decimal import Decimal as D

B = Path(__file__).resolve().parent.parent
ROOT = B.parent.parent
H = lambda b: hashlib.sha256(b).hexdigest()
canonical = lambda v: json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
base_bytes = (ROOT / 'site/data/portraits.json').read_bytes()
portraits = {p['slug']: p for p in json.loads(base_bytes)['portraits']}
checks, source_paths, snapshot_paths = [], set(), set()
def check(name, actual, expected):
    checks.append({'check': name, 'pass': actual == expected, 'actual': actual, 'expected': expected})
def raw(path):
    b = (B / path).read_bytes()
    return gzip.decompress(b) if path.endswith('.gz') else b
def rows(path, delimiter='|'):
    return list(csv.DictReader(io.StringIO(raw(path).decode('cp1252')), delimiter=delimiter))
def pdftext(path):
    return subprocess.check_output(['pdftotext', '-layout', str(B/path), '-']).decode()

records = []
for filename in ['amendments.json', 'supplemental-housing.json']:
    content = (B/'findings'/filename).read_bytes()
    doc = json.loads(content)
    check(filename + ': baseline hash', H(base_bytes), doc['baseline_snapshot_sha256'])
    for a in doc['amendments']:
        records.append(a)
        dimension = next(d for d in portraits[a['portrait']]['dimensions'] if d['slug'] == a['dimension'])
        actual = dimension['indicators'][a['indicator_index']] if len(dimension['indicators']) > a['indicator_index'] else None
        check(a['id'] + ': before', actual, a['before'])
        for s in a['source_support']:
            source_paths.add(s['raw_path'])
            check(a['id']+': raw '+s['raw_path'], H(raw(s['raw_path'])), s['raw_sha256'])
            if s.get('stored_sha256'):
                check(a['id']+': stored', H((B/s['raw_path']).read_bytes()), s['stored_sha256'])
            if s.get('snapshot_path'):
                snapshot_paths.add(s['snapshot_path'])
                check(a['id']+': exhibit', H((B/s['snapshot_path']).read_bytes()), s['snapshot_sha256'])
        scoring = a['after'].get('scoring')
        if scoring:
            q = scoring['inputs']
            expected = (q['value']-q['target'])/q['scale']*100
            if scoring['function']=='higher_is_better': expected = -expected
            check(a['id']+': score arithmetic within 0.051', abs(expected-a['after']['level_pct'])<.051, True)

for filename in ['evidence-manifest.json','supplemental-evidence-manifest.json']:
    manifest=json.loads((B/filename).read_text())
    for path, entry in manifest.items():
        check(filename+': '+path, H((B/path).read_bytes()), entry['sha256'])

pm = json.loads(raw('raw/nyc-pm25-2024.json'))
check('PM2.5 exact city/time/measure/value', [(r['geo_type_name'],r['time_period'],r['measure'],r['data_value']) for r in pm], [('Citywide','2024','Annual mean','6.255051193')])
food = pdftext('raw/bronx-food-2024-report.pdf')
check('Food PDF identifies 2022 Bronx20.2', bool(re.search(r'as of 2022',food)) and '290,990 people (20.2%)' in food, True)
water = pdftext('raw/nyc-water-2025-mirror.pdf')
check('Water DEP2025 standards statement', 'meeting or exceeding all drinking water standards' in water, True)
echo = (B/'raw/nyc-echo-current.txt').read_text()
check('ECHO historical addressed TT exists', all(s in echo for s in ['#20170201','02/01/2017','Treatment Technique Violation','Addressed','05/15/2019']), True)

waste = {}
for scope, path in [('CY','raw/dsny-raw-cy.json'),('FY','raw/dsny-raw-fy.json')]:
    source = json.loads(raw(path))
    for place in ['Bronx','CITY']:
        totals=[]
        for year in [2005,2025]:
            selected=[r for r in source if (place=='CITY' or r['borough']==place) and (int(r['month'][:4]) + (scope=='FY' and int(r['month'][-2:])>=7)) == year]
            ids=[(r['month'],r['borough'],r['communitydistrict']) for r in selected]
            check(f'{scope} {place} {year}: unique records',len(ids),len(set(ids)))
            check(f'{scope} {place} {year}: months',len({r['month'] for r in selected}),12)
            check(f'{scope} {place} {year}: row coverage',len(selected),144 if place=='Bronx' else 708)
            total=sum(D(r['refusetonscollected']) for r in selected)
            totals.append(total)
            if scope=='CY' and place=='Bronx':
                omitted=sum(D(r['refusetonscollected']) for r in selected if r['month'][-2:]!='01')
                check(f'Bronx {year} missing-Jan reproduces old total',str(omitted),'513421.85' if year==2005 else '478703.47')
        waste[scope+':'+place]={'totals':[str(n) for n in totals],'reduction':float((totals[0]-totals[1])/totals[0]*100)}
check('Bronx CY reduction rounded',round(waste['CY:Bronx']['reduction'],2),6.44)
check('NYC FY reduction rounded',round(waste['FY:CITY']['reduction'],2),12.55)

pop = {}
for vintage in [2024,2025]:
    selected=[r for r in rows(f'raw/census-county-pop-v{vintage}.csv',',') if r['STATE']=='36' and r['COUNTY'] in ['005','047','061','081','085']]
    check(f'Population {vintage} complete counties',len(selected),5)
    pop[vintage]={r['COUNTY']:int(r['POPESTIMATE2024']) for r in selected}
check('NYC V2024 population',sum(pop[2024].values()),8478072)
check('NYC V2025 population',sum(pop[2025].values()),8596825)
ghg = [r for r in json.loads(raw('raw/nyc-ghg-full.json')) if r.get('inventory_type')=='Total']
check('GHG Total single row',len(ghg),1)
emissions=D(ghg[0]['cy_2024_tco2e']); baseline=D(ghg[0]['cy_2005_tco2e_100_yr_gwp'])
check('GHG2024 total',str(emissions),'47944551.47')
check('GHG2005 total',str(baseline),'64139720.6')
check('GHG percap V2024 rounded',round(float(emissions/sum(pop[2024].values())),2),5.66)
check('GHG reduction rounded',round(float((baseline-emissions)/baseline*100),2),25.25)
check('LL97 source has43% and2024 benchmarking', all(s in (B/'raw/nyc-ll97.txt').read_text() for s in ['43%','benchmarking data (2024)','2030']), True)

tri = json.loads(raw('raw/nyc-tri-2024.json'))
selected=[r for r in tri if r['county'] in ['BRONX','KINGS','NEW YORK','QUEENS','RICHMOND']]
check('TRI unit uniform Pounds',sorted({r['unit of measure'] for r in selected}),['Pounds'])
excluded=[r for r in selected if r['county']=='NEW YORK' and r['city']=='JAMESTOWN']
check('TRI excluded Jamestown records',len(excluded),2)
check('TRI Jamestown longitudes outside NYC',all(r['longitude'] < -79 for r in excluded),True)
selected=[r for r in selected if r not in excluded]
tri_results={}
for place in ['CITY','BRONX']:
    rs=[r for r in selected if place=='CITY' or r['county']==place]
    form_counts=dict(collections.Counter(r['form type'] for r in rs))
    amount=sum(D(str(r['on-site release total'])) for r in rs if r['form type']=='R')
    denominator=sum(pop[2025].values()) if place=='CITY' else pop[2025]['005']
    tri_results[place]={'forms':form_counts,'quantified_lbs':str(amount),'population':denominator,'lb_per_resident':float(amount/denominator)}
check('TRI CITY FormR amount',tri_results['CITY']['quantified_lbs'],'210234.1768175')
check('TRI BRONX FormR amount',tri_results['BRONX']['quantified_lbs'],'1355.76362')
check('TRI CITY missing FormA count',tri_results['CITY']['forms']['A'],9)
check('TRI BRONX missing FormA count',tri_results['BRONX']['forms']['A'],2)

conservation=pdftext('raw/nyc-protected-2023.pdf')
county_areas=[('Bronx',30863,5646),('Kings',52820,12804),('New York',20528,2735),('Queens',80102,14071),('Richmond',37869,8118)]
for county, area, protected in county_areas:
    pattern=rf'{county} County\s+Total Area: {area:,} acres\s+Total Protected Land and Water Area: {protected:,} acres'
    check('Conservation PDF '+county,bool(re.search(pattern,conservation)),True)
conservation_share=sum(z[2] for z in county_areas)/sum(z[1] for z in county_areas)*100
check('Conservation rounded observed value',round(conservation_share,1),19.5)
# Intentionally record a failing check: this mismatch is an amendment blocker.
check('Conservation exhibit unrounded arithmetic',f'{conservation_share:.8f}' in (B/'calculations/nyc-conservation-extract.html').read_text(),True)

paper=raw('raw/nyc-ocean-study.bin').decode()
check('Ocean source value Table1',bool(re.search(r'<table\b[^>]*>.*?1\.09.*?</table>',paper,re.S)),True)
check('Ocean season and depth caption','summertime (July' in paper and 'average bottom water' in paper,True)

geos={'santa-cruz':'1600000US0669112','watsonville':'1600000US0683668','santa-cruz-county':'0500000US06087'}
census={}
for stem in ['acs5-gini2024.bin.gz','acs1-gini2024.bin','acs5-poverty2024.bin.gz','acs5-broadband2024.bin.gz']:
    census[stem]={r['GEO_ID']:r for r in rows('raw/'+stem) if r['GEO_ID'] in geos.values()}
for portrait, gini, poverty, broadband in [('santa-cruz',.4936,17.0,95.5),('watsonville',.4282,14.7,89.5)]:
    geo=geos[portrait]
    check(portrait+' Gini primary',float(census['acs5-gini2024.bin.gz'][geo]['B19083_E001']),gini)
    r=census['acs5-poverty2024.bin.gz'][geo]
    check(portrait+' poverty primary',round((int(r['C17002_E002'])+int(r['C17002_E003']))/int(r['C17002_E001'])*100,1),poverty)
    r=census['acs5-broadband2024.bin.gz'][geo]
    check(portrait+' broadband primary',round(int(r['B28002_E004'])/int(r['B28002_E001'])*100,1),broadband)
check('SC county Gini ACS1',float(census['acs1-gini2024.bin'][geos['santa-cruz-county']]['B19083_E001']),.4864)
gct=next(r for r in rows('raw/broadband-2024-comparison.csv',',') if r['GEOID']==geos['santa-cruz-county'])
check('SC county GCT broadband value',float(gct['ESTIMATE']),94.9)
check('SC county GCT broadband MOE',gct['MG_ERROR'],'+/-1.1')
check('County GCT row present in cited exhibit','94.9' in (B/'calculations/sc-census-extract.html').read_text(),True)
shells=raw('raw/acs5-shells2024.bin.gz').decode()
for label in ['B25070_007|30.0 to 34.9 percent','B28002_004|Broadband of any type','C17002_002|Under .50','C17002_003|.50 to .99']:
    check('Census label '+label,label in shells,True)

osc=pdftext('../../site/evidence/shared/e89455fc53fef9ac48a438f1.pdf')
check('OSC Figure4 Bronx63.3',bool(re.search(r'Bronx\s+28\.9%\s+63\.3%',osc)),True)
check('OSC Figure4 Staten76.5',bool(re.search(r'Staten Island\s+13\.3%\s+76\.5%',osc)),True)
pit=pdftext('raw/sc-pit-2026-full.pdf')
check('PIT City source retains arithmetic conflict',bool(re.search(r'City of Santa Cruz\*\s+612\s+789\s+250\s+234\s+862\s+1,024',pit)),True)
check('PIT Watsonville303',bool(re.search(r'City of Watsonville\*\s+234\s+179\s+101\s+124\s+335\s+303',pit)),True)
check('PIT County1648','1,648' in pit,True)
check('PIT shelter and street dates','January 28, 2026' in pit and 'January 29, 2026' in pit,True)
release=pdftext('raw/sc-pit-2026-release.pdf')
check('PIT county release corroborates1648','1,648' in release,True)

eji_path='../carmel-monterey-2026-10-23-sol-medium/calculations/extreme-heat/raw/EJI_2024_California_CSV.zip'
with zipfile.ZipFile(B/eji_path) as z:
    erows=list(csv.DictReader(io.StringIO(z.read('EJI_2024_California.csv').decode('utf-8-sig'))))
    dictionary=z.read('EJI_DATADICTIONARY_2024.csv').decode('cp1252')
    check('EJI source95thpercentile definition','95th percentile of historical maximum temperatures for that tract' in dictionary,True)
    check('EJI dictionary estimated variables','Variables beginning with "E_" are estimates' in dictionary.replace('""','"'),True)
tracts=[r for r in erows if r['STATEFP']=='06' and r['COUNTYFP']=='087']
check('Heat complete EJI tractcount',len(tracts),69)
check('Heat no duplicate tracts',len({r['GEOID'] for r in tracts}),69)
check('Heat no missing weights or observations',all(float(r['E_TOTPOP'])>=0 and float(r['E_NEHD'])>=0 for r in tracts),True)
weight=sum(D(r['E_TOTPOP']) for r in tracts)
weighted=sum(D(r['E_TOTPOP'])*D(r['E_NEHD']) for r in tracts)
check('Heat population weights',float(weight),268571.0)
check('Heat weighted sum',float(weighted),3963492.8)
check('Heat independent weighted mean',round(float(weighted/weight),10),14.757709507)
coverage=json.loads(raw('raw/sc-census2020-tract-coverage-correct.bin'))['features']
omitted=[r['attributes'] for r in coverage if r['attributes']['GEOID'] not in {r['GEOID'] for r in tracts}]
check('Heat Census omitted only zero-pop zero-land tract',[(r['GEOID'],r['POP100'],r['AREALAND']) for r in omitted],[('06087990100',0,0)])

rent_results=[]
for portrait,filename,geo in [('carmel','acs5-rentburden2024.bin.gz','1600000US0611250'),('monterey-county','acs1-rentburden2024.bin','0500000US06053')]:
    r=next(r for r in rows('raw/'+filename) if r['GEO_ID']==geo)
    numerator=sum(int(r[f'B25070_E{i:03}']) for i in range(7,11))
    denominator=int(r['B25070_E001'])-int(r['B25070_E011'])
    lo=(numerator-int(r['B25070_E007']))/denominator*100
    hi=numerator/denominator*100
    check(portrait+' rentburden ≥30 primary',round(hi,1),55.7 if portrait=='carmel' else 58.0)
    rent_results.append({'portrait':portrait,'numerator_ge30':numerator,'denominator_computable':denominator,'pct_ge30':hi,'strict_over30_bounds':[lo,hi]})

gapdoc=json.loads((B/'findings/gap-dispositions.json').read_text())
for g in gapdoc['dispositions']:
    data=(ROOT/g['baseline_finding_path']).read_bytes()
    check('Gap hash '+g['portrait']+'/'+g['dimension'],H(data),g['baseline_finding_sha256'])
    check('Gap unchanged '+g['portrait']+'/'+g['dimension'],json.loads(data),g['baseline_finding'])

out={'schema_version':1,'reviewer':'gpt-6.1-sol','reasoning_effort':'high','read_only_inputs':True,'total_checks':len(checks),'passed':sum(c['pass'] for c in checks),'failed':[c for c in checks if not c['pass']],'unique_raw_sources':len(source_paths),'unique_exhibits':len(snapshot_paths),'source_support_entries':sum(len(a['source_support']) for a in records),'calculations':{'waste':waste,'tri':tri_results,'conservation_exact_pct':conservation_share,'heat_mean':float(weighted/weight),'rent_burden':rent_results},'checks':checks}
(B/'reviews/independent-sol-high-checks.json').write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in out.items() if k not in ['checks','calculations']},indent=2))
