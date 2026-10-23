"""Offline reproduction: Python 3, shapely, pyproj, pyshp. No network needed."""
import json,pathlib,zipfile,io,csv,gzip
import shapefile
from shapely.geometry import shape,mapping
from shapely.ops import transform,unary_union
from shapely import make_valid
from pyproj import Transformer
R=pathlib.Path(__file__).parent; raw=R/'raw'
project=Transformer.from_crs(4326,3310,always_xy=True).transform
def geom(g): return make_valid(transform(project,shape(g)))
def read(name): return json.loads((raw/name).read_text())
z=zipfile.ZipFile(raw/'tl_2026_06053_faces.zip')
def member(ext): return io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(ext))))
r=shapefile.Reader(shp=member('.shp'),shx=member('.shx'),dbf=member('.dbf'))
water=unary_union([geom(sr.shape.__geo_interface__) for sr in r.iterShapeRecords() if sr.record['LWFLAG']=='P'])
print('Census faces:',len(r),'; excluded perennial-water faces:',sum(a['LWFLAG']=='P' for a in r.records()))
cons=[]; attrs=[]; downloaded_count=0
for p in sorted(raw.glob('conservation2024-features-*.json.gz')):
 for f in json.loads(gzip.decompress(p.read_bytes()))['features']:
  downloaded_count += 1
  if f['properties']['Release_Year'] != 2024: continue
  assert str(f['properties']['reGAP']) in ['1','2']
  cons.append(geom(f['geometry']));attrs.append(f['properties'])
assert downloaded_count==len(read('conservation2024-ids.json')['objectIds'])
assert len(cons)==1316
protected=unary_union(cons)
results={}; detail=[]
for region,filename in [('carmel','carmel-lafco-boundary.json'),('monterey-county','monterey-census-boundary.json'),('carmel-census-crosscheck','carmel-census-boundary.json')]:
 boundary=unary_union([geom(f['geometry']) for f in read(filename)['features']]);land=boundary.difference(water); numerator=protected.intersection(land)
 clipped=[g.intersection(land) for g in cons]
 a=land.area;n=numerator.area
 results[region]={'land_m2':a,'protected_m2':n,'land_acres':a/4046.8564224,'protected_acres':n/4046.8564224,'protected_share_pct':n/a*100,'level_pct':(30-n/a*100)/30*100,'boundary_total_m2':boundary.area,'water_removed_m2':boundary.area-a,'summed_protected_before_dedup_m2':sum(g.area for g in clipped),'overlap_removed_m2':sum(g.area for g in clipped)-n,'intersecting_feature_count':sum(g.area>0 for g in clipped)}
 for g,at in zip(clipped,attrs):
  if g.area>0: detail.append({'jurisdiction':region,'objectid':at['OBJECTID'],'gap':at['reGAP'],'name':at.get('UNIT_NAME') or at.get('cpad_PARK_NAME'),'clipped_m2':g.area})
 with gzip.open(R/f'{region}-derived-land-and-protected.geojson.gz','wt') as archive: archive.write(json.dumps({'type':'FeatureCollection','crs':{'type':'name','properties':{'name':'EPSG:3310'}},'features':[{'type':'Feature','properties':{'role':'jurisdiction_land'},'geometry':mapping(land)},{'type':'Feature','properties':{'role':'durably_protected_land_gap_1_2'},'geometry':mapping(numerator)}]}))
(R/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
with (R/'clipped-feature-areas.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=detail[0].keys());w.writeheader();w.writerows(detail)
