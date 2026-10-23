import urllib.request,urllib.parse,json,pathlib,hashlib,datetime
root=pathlib.Path(__file__).parent/'raw'; log=[]
def get(url,name):
 p=root/name
 if p.exists(): return json.loads(p.read_bytes()) if name.endswith('.json') else p.read_bytes()
 r=urllib.request.urlopen(url,timeout=180); data=r.read(); p.write_bytes(data); log.append({'url':url,'file':name,'sha256':hashlib.sha256(data).hexdigest(),'retrieved_at':datetime.datetime.now(datetime.UTC).isoformat()}); (root/'download-provenance.json').write_text(json.dumps(log,indent=2)); return json.loads(data) if name.endswith('.json') else data
def query(base,params,name): return get(base+'/query?'+urllib.parse.urlencode({'f':'geojson','outFields':'*','returnGeometry':'true','outSR':4326,**params}),name)
cons=json.loads((root/'conservation-item-2026.json').read_text())['url']+'/0'
meta=get(cons+'?f=pjson','conservation-layer-2026.json')
print('conservation fetching')
# Envelope catches all features touching county, including features with imperfect county attribute assignment.
q={'where':"reGAP IN ('1','2')",'geometry':'-122.1,35.7,-120.1,37.1','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','returnIdsOnly':'true','f':'json'}
ids=get(cons+'/query?'+urllib.parse.urlencode(q),'conservation-ids.json')['objectIds'];print('ids',len(ids))
for i in range(0,len(ids),50):
 x=query(cons,{'objectIds':','.join(map(str,ids[i:i+50]))},f'conservation-features-{i:04}.json');print(i,len(x.get('features',[])),x.get('error'))
print('boundaries')
query('https://maps.co.monterey.ca.us/server/rest/services/LAFCO/Incorporated_Cities_2/FeatureServer/2',{'where':"CITY = 'CARMEL BY-THE-SEA'"},'carmel-lafco-boundary.json')
query('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',{'where':"GEOID = '06053'"},'monterey-census-boundary.json')
query('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4',{'where':"GEOID = '0611250'"},'carmel-census-boundary.json')
print('water')
get('https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_06053_areawater.zip','tl_2025_06053_areawater.zip')
