#!/usr/bin/env python3
"""Cheap deterministic checks; these do not replace independent claim review."""
import csv,hashlib,json,pathlib,re,sys
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[1]
def read(name):return json.loads((ROOT/'data'/name).read_text())
D=read('portrait-series.json');sources={s['id']:s for s in D['sources']};indicators={i['id']:i for i in D['indicators']}
checks=[]
for s in sources.values():
 p=(ROOT/s['path']).resolve();assert p.is_relative_to(ROOT);assert p.is_file(),s['id'];assert hashlib.sha256(p.read_bytes()).hexdigest()==s['sha256'],s['id']
checks.append(f'{len(sources)} archived source hashes and paths match')
assert len({(r['indicator_id'],r['period_start'],r['period_end']) for r in D['observations']})==len(D['observations'])
for r in D['observations']:
 assert r['period_start']<=r['period_end']<=D['as_of'];assert r['indicator_id'] in indicators
 if r['value'] is None:assert r['status']=='missing' and r['missing_reason']
 else:assert r['status']=='source-supported-observation' and r['epistemic_type']=='retrospective-estimate' and r['source_id'] in sources and r['source_locator']
checks.append(f'{len(D["observations"])} unique dated rows have consistent source and missing-data status')
for r in D['observations']:
 if r['indicator_id'] in ['material_footprint','domestic_material_consumption'] and r['observation_year']>=2020:assert r['value'] is None
checks.append('Projection-contaminated UNEP2020+ values excluded from main empirical history')
assert all(r['year']<=2015 for r in read('published-historical-reference.json')['records'])
checks.append('Original Doughnut BAU2016–2050 sheets excluded')
for e in D['events']:
 assert e['source_id'] in sources;assert e['date']<=D['as_of'];assert e['causal_status']=='chronology only; not an estimated treatment effect'
checks.append(f'{len(D["events"])} event dates have archived primary sources and chronology-only status')
class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  if tag=='a':self.links.extend(v for k,v in attrs if k=='href')
for paper in ['argentina-working-paper.html','methods-paper.html']:
 p=Links();p.feed((ROOT/paper).read_text())
 for link in p.links:
  if link.startswith('https://'):continue
  assert (ROOT/link.split('#')[0]).exists(),(paper,link)
checks.append('Both manuscripts parse and all local evidence/manuscript links resolve')
def point(id,start):return next(r['value'] for r in D['observations'] if r['indicator_id']==id and r['period_start']==start)
assert abs(point('poverty','2026-01-01')-point('poverty','2023-07-01')+9.4)<1e-10
assert abs(point('poverty','2026-01-01')-point('poverty','2025-07-01')-4.1)<1e-10
assert abs(point('indigence','2026-01-01')-point('indigence','2025-07-01')-1.2)<1e-10
checks.append('Load-bearing poverty/indigence change arithmetic separately recomputed from extracted rows')
result={'status':'deterministic-checks-passed','limits':'Not independent scientific verification or peer review. Root source review is separate.','checks':checks}
(ROOT/'data/verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
