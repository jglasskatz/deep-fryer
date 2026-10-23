import urllib.request,urllib.parse,json,pathlib
root=pathlib.Path(__file__).parent/'raw'
def get(url,name):
 data=urllib.request.urlopen(url,timeout=120).read(); (root/name).write_bytes(data); return json.loads(data)
x=get('https://services8.arcgis.com/JFYbogndXme7ddg8/arcgis/rest/services/CA_Cons_Areas_parentlyr_Merge_ecofix/FeatureServer/55?f=pjson','conservation-layer-2024.json')
print('fields',[(f['name'],f.get('domain')) for f in x['fields']])
x=get('https://www.arcgis.com/sharing/rest/search?'+urllib.parse.urlencode({'f':'json','q':'owner:CA_Nature AND "30x30 Conserved Areas"','num':100}),'item-search.json')
print([(r['id'],r['title']) for r in x['results']])
