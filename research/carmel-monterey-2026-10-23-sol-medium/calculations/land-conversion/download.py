"""Acquire official Annual NLCD C1V1 raw class TIFFs on their native grid.
Run with Python 3 + shapely + pyproj + rasterio. Network only; calculate.py is offline.
"""
import json,pathlib,urllib.request,urllib.parse,hashlib,math,datetime
from shapely.geometry import shape
from shapely.ops import transform,unary_union
from pyproj import Transformer,CRS
R=pathlib.Path(__file__).parent; raw=R/'raw';raw.mkdir(exist_ok=True)
S='https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_Landcover_CONUS/ImageServer'
manifest=[]
def get(url,name):
 p=raw/name
 try:
  b=urllib.request.urlopen(url,timeout=180).read();p.write_bytes(b)
  manifest.append({'url':url,'file':'raw/'+name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'success'})
  (R/'download-manifest.json').write_text(json.dumps(manifest,indent=2));return b
 except Exception as e:
  manifest.append({'url':url,'file':'raw/'+name,'status':'failure','error':str(e)});(R/'download-manifest.json').write_text(json.dumps(manifest,indent=2));raise
# The original run reused same-campaign official boundary bytes. The copied
# provenance and inputs make this folder self-contained; reacquire only if absent.
for record in json.loads((R/'boundary-provenance.json').read_text()):
 name=pathlib.Path(record['file']).name
 if not (raw/name).exists(): get(record['url'],name)
 # Fail rather than silently treating a later mutable boundary as the archived one.
 assert hashlib.sha256((raw/name).read_bytes()).hexdigest()==record['sha256_stored']
catalog=json.loads((raw/'usfs-catalog-2014-2024.json').read_text())
assert {f['attributes']['objectid']:f['attributes']['name'] for f in catalog['features']}=={30:'Annual_NLCD_LndCov_2014_CU_C1V1',40:'Annual_NLCD_LndCov_2024_CU_C1V1'}
info=json.loads(get(S+'/30/info?f=pjson','raster30-native-info.json'))
info24=json.loads(get(S+'/40/info?f=pjson','raster40-native-info.json'))
for k in ['origin','pixelSizeX','pixelSizeY','extent']: assert info[k]==info24[k],k
wkt=info['extent']['spatialReference']['wkt'];crs=CRS.from_wkt(wkt);proj=Transformer.from_crs(4326,crs,always_xy=True).transform
g=unary_union([transform(proj,shape(f['geometry'])) for f in json.loads((raw/'monterey-census-boundary.json').read_text())['features']])
ox=info['origin']['x'];oy=info['origin']['y'];xmin,ymin,xmax,ymax=g.bounds
xmin=ox+math.floor((xmin-ox)/30)*30;ymin=oy+math.floor((ymin-oy)/30)*30
xmax=ox+math.ceil((xmax-ox)/30)*30;ymax=oy+math.ceil((ymax-oy)/30)*30
width=round((xmax-xmin)/30);height=round((ymax-ymin)/30)
grid={'bbox':[xmin,ymin,xmax,ymax],'width':width,'height':height,'pixel_size_m':30,'crs_wkt':wkt}
(R/'grid.json').write_text(json.dumps(grid,indent=2));print(grid,flush=True)
for year,rid in [(2014,30),(2024,40)]:
 params={'f':'json','bbox':','.join(map(str,grid['bbox'])),'bboxSR':json.dumps({'wkt':wkt}),'imageSR':json.dumps({'wkt':wkt}),'size':f'{width},{height}','format':'tiff','pixelType':'U8','interpolation': 'RSP_NearestNeighbor','renderingRule':json.dumps({'rasterFunction':'None'}),'mosaicRule':json.dumps({'mosaicMethod':'esriMosaicLockRaster','lockRasterIds':[rid]}),'noData':'0','noDataInterpretation':'esriNoDataMatchAny','adjustAspectRatio':'false'}
 u=S+'/exportImage?'+urllib.parse.urlencode(params)
 result=json.loads(get(u,f'export-{year}.json'));print(year,result,flush=True)
 assert 'href' in result,result
 get(result['href'],f'landcover-{year}.tif')
