import urllib.request,urllib.parse,pathlib,json,hashlib,datetime,gzip
R=pathlib.Path(__file__).parent;raw=R/'raw'
base='https://services8.arcgis.com/JFYbogndXme7ddg8/arcgis/rest/services/CA_Cons_Areas_parentlyr_Merge_ecofix/FeatureServer/55'
def get(url,name,compress=False):
 b=urllib.request.urlopen(url,timeout=120).read();p=raw/(name+('.gz' if compress else ''))
 if compress:
  with gzip.open(p,'wb') as f:f.write(b)
 else:p.write_bytes(b)
 m=json.loads((R/'raw-manifest.json').read_text());m.append({'file':'raw/'+p.name,'url':url,'retrieved_at':datetime.datetime.now(datetime.UTC).isoformat(),'sha256_original':hashlib.sha256(b).hexdigest(),'sha256_stored':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes_stored':p.stat().st_size});(R/'raw-manifest.json').write_text(json.dumps(m,indent=2));return json.loads(b)
get('https://www.arcgis.com/sharing/rest/content/items/6dc5f19f7f6c4413a3bac944d1f9a173?f=json','conservation-item-2024.json')
ids=get(base+'/query?'+urllib.parse.urlencode({'f':'json','where':"reGAP IN ('1','2')",'geometry':'-122.1,35.7,-120.1,37.1','geometryType':'esriGeometryEnvelope','inSR':4326,'returnIdsOnly':'true'}),'conservation2024-ids.json')['objectIds'];print('ids',len(ids),flush=True)
for i in range(0,len(ids),100):
 x=get(base+'/query?'+urllib.parse.urlencode({'f':'geojson','outFields':'*','objectIds':','.join(map(str,ids[i:i+100])),'outSR':4326,'returnGeometry':'true'}),f'conservation2024-features-{i:04}.json',True);print(i,len(x['features']),flush=True)
