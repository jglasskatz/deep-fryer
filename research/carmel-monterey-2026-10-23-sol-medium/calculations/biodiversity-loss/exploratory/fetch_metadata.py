exec(open(__file__.replace('fetch_metadata.py','explore.py')).read().split("x=get(")[0])
x=get('https://www.arcgis.com/sharing/rest/content/items/27e624d12db24a84aada720f4a9748ab?f=json','conservation-item-2026.json'); print(x['url']); print(x['description'][:1000]); service=x['url']
x=get(service+'?f=json','conservation-service-2026.json'); print(x['layers'])
x=get(service+'/'+str(x['layers'][0]['id'])+'?f=json','conservation-layer-2026.json'); print([(f['name'],f.get('domain')) for f in x['fields']]); print(x.get('drawingInfo'))
