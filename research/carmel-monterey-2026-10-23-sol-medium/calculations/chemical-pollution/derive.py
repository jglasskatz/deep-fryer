"""Reproduce the reported TRI inventory measure; Python standard library only."""
from pathlib import Path
from decimal import Decimal
import csv,json,hashlib,math,html
BASE=Path(__file__).resolve().parent
RAW=BASE/'raw'
def rows(name,encoding='utf-8-sig'):
 return list(csv.DictReader((RAW/name).open(encoding=encoding)))
def in_ring(x,y,ring):
 inside=False
 for (ax,ay),(bx,by) in zip(ring,ring[1:]+ring[:1]):
  if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax: inside=not inside
 return inside
def inside(x,y,g):
 polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
 return any(in_ring(x,y,p[0]) and not any(in_ring(x,y,h) for h in p[1:]) for p in polys)
def geometry(name):return json.loads((RAW/name).read_text())['features'][0]['geometry']
def gap_km(x,y,g):
 # Minimum point-to-segment separation in local equirectangular projection;
 # used to detect boundary ambiguity, never to allocate releases.
 polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
 d=1e20
 for p in polygons:
  for ring in p:
   for a,b in zip(ring,ring[1:]+ring[:1]):
    ax=(a[0]-x)*111.32*math.cos(math.radians(y));ay=(a[1]-y)*111.32
    bx=(b[0]-x)*111.32*math.cos(math.radians(y));by=(b[1]-y)*111.32
    dx,dy=bx-ax,by-ay;t=max(0,min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))) if dx or dy else 0
    d=min(d,math.hypot(ax+t*dx,ay+t*dy))
 return d
r=rows('2024_CA.csv');assert len(r)==3361 and all(x['1. YEAR']=='2024' and x['8. ST']=='CA' for x in r)
assert len(set(x['36. DOC_CTRL_NUM'] for x in r))==len(r)
assert all(x['12. LATITUDE'] and x['13. LONGITUDE'] for x in r)
city=geometry('carmel-lafco-boundary.json');county=geometry('monterey-census-boundary.json');citycheck=geometry('carmel-census-boundary.json')
selected={k:[x for x in r if inside(float(x['13. LONGITUDE']),float(x['12. LATITUDE']),g)] for k,g in [('carmel',city),('carmel_census_crosscheck',citycheck),('county_spatial_crosscheck',county)]}
selected['monterey-county']=[x for x in r if x['7. COUNTY']=='MONTEREY']
assert {x['36. DOC_CTRL_NUM'] for x in selected['monterey-county']}=={x['36. DOC_CTRL_NUM'] for x in selected['county_spatial_crosscheck']}
assert not selected['carmel'] and not selected['carmel_census_crosscheck']
cp=[x for x in rows('co-est2025-alldata.csv','latin1') if (x['STATE'],x['COUNTY'],x['SUMLEV'])==('06','053','050')][0]
mp=[x for x in rows('sub-est2025.csv','latin1') if (x['STATE'],x['PLACE'],x['SUMLEV'])==('06','11250','162')][0]
res={'year':2024,'state_form_rows':len(r),'state_facilities':len(set(x['2. TRIFD'] for x in r)),'missing_coordinates':0,'spatial_county_matches_county_field':True,'population_vintage':2025,'population_reference':'July 1, 2024','carmel_boundary_census_crosscheck':True}
near=sorted({(gap_km(float(x['13. LONGITUDE']),float(x['12. LATITUDE']),city),x['2. TRIFD'],x['4. FACILITY NAME']) for x in r})[:5]
res['nearest_state_reporters_to_carmel_boundary_km']=[{'km':d,'trifid':i,'facility':n} for d,i,n in near]
for key,pop in [('carmel',mp),('monterey-county',cp)]:
 rr=selected[key];quant=[x for x in rr if x['49. FORM TYPE']=='R'];unquant=[x for x in rr if x['49. FORM TYPE']=='A']
 assert all(x['50. UNIT OF MEASURE']=='Pounds' for x in rr)
 n=sum((Decimal(x['65. ON-SITE RELEASE TOTAL']) for x in quant),Decimal(0));p=int(pop['POPESTIMATE2024']);v=float(n/Decimal(p))
 res[key]={'forms':len(rr),'facilities':len(set(x['2. TRIFD'] for x in rr)),'quantified_R_forms':len(quant),'unquantified_A_forms':len(unquant),'form_A_chemicals':[x['37. CHEMICAL'] for x in unquant],'onsite_quantified_R_pounds':str(n),'population':p,'value':v,'level_pct':(v-1)*100,'population_source_row':pop}
 with (BASE/(key+'-forms.csv')).open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(r[0]));w.writeheader();w.writerows(rr)
json.dump(res,(BASE/'results.json').open('w'),indent=2)
json.dump({f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(RAW.iterdir()) if f.is_file()},(BASE/'sha256.json').open('w'),indent=2)
lines=['<!doctype html><meta charset="utf-8"><title>2024 EPA TRI reported on-site releases — researcher extract</title><style>body{font:18px system-ui;max-width:1250px;margin:40px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:10px;text-align:left}small{font-size:15px}h1{font-size:28px}</style><h1>2024 EPA TRI reported on-site releases</h1><p>Researcher-generated faithful extract and calculation, not an EPA publication. Raw files, row filters, spatial checks and SHA-256 hashes accompany derive.py.</p>','<p>EPA full California file: 3,361 forms; '+str(res['state_facilities'])+' reporting facilities; no missing coordinates. Federal and tribal reporters included. Field 65 ON-SITE RELEASE TOTAL: air, water, underground injection and land releases. Excludes off-site transfers, off-site releases, treatment, recycling and total waste managed.</p>','<table><tr><th>Jurisdiction</th><th>2024 inventory</th><th>Quantified Form R releases (lb)</th><th>July 2024 population</th><th>lb / resident / year</th></tr>']
for k in ['carmel','monterey-county']:
 q=res[k];lines.append(f"<tr><td>{k}</td><td>{q['facilities']} facilities; {q['quantified_R_forms']} Form R; {q['unquantified_A_forms']} Form A</td><td>{q['onsite_quantified_R_pounds']}</td><td>{q['population']:,}</td><td>{q['value']:.10f}</td></tr>")
lines+=['</table><h2>Monterey County source rows</h2><table><tr><th>Facility</th><th>Chemical</th><th>Form</th><th>Unit</th><th>On-site release</th></tr>']
for x in selected['monterey-county']:
 lines.append('<tr>'+''.join('<td>'+html.escape(x[f])+'</td>' for f in ['4. FACILITY NAME','37. CHEMICAL','49. FORM TYPE','50. UNIT OF MEASURE','65. ON-SITE RELEASE TOTAL'])+'</tr>')
lines+=['</table><p><strong>Form A caveat:</strong> DOLE FRESH VEGETABLES reports an unquantified Form A. Its basic-file zero is an EPA placeholder, not measured zero. The 24,485.44 lb is the sum of seven quantified Form R rows; it omits any release associated with that Form A. A qualifying Form A certifies total annual reportable amount at most 500 lb, so its unquantified on-site contribution is bounded by 500 lb (not added as an observation).</p>',f"<p><strong>Carmel coverage:</strong> Every California reporting facility coordinate was tested against LAFCO incorporated-city polygon, crosschecked with Census city polygon. Neither contains a reporting facility. Nearest reporter is {near[0][2]} ({near[0][0]:.2f} km outside). This is zero in the reported TRI inventory; it is not a measured zero of all chemical releases or proof every legally obligated facility complied.</p>",'<p>County filter MONTEREY matches statewide point-in-county selection exactly, covering incorporated and unincorporated county. All selected quantity units are Pounds; no dioxin grams are mixed into the sum. In general grams would require /453.59237 to convert to pounds.</p>','<h2>Source URLs and archived raw inputs</h2>']
for u in ['https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/2024_CA/csv','https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv','https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv','https://maps.co.monterey.ca.us/server/rest/services/LAFCO/Incorporated_Cities_2/FeatureServer/2']:
 lines.append('<p><small>'+u+'</small></p>')
lines.append('<p>Population: Census Population Estimates Program Vintage 2025, POPESTIMATE2024, county 06053 and incorporated place 0611250. EPA landing page states reporting forms processed through November 5, 2025. TRI applies to covered industries/federal facilities subject to employee and chemical thresholds; it excludes much household, mobile-source and below-threshold pollution and is neither toxicity-weighted nor an exposure/risk measure.</p>')
(BASE/'source-extract.html').write_text('\n'.join(lines))
print(json.dumps({k:v for k,v in res.items() if k not in ['carmel','monterey-county']},indent=2));print({k:(res[k]['value'],res[k]['level_pct']) for k in ['carmel','monterey-county']})
