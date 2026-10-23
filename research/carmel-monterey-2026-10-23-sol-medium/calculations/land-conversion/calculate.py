"""Offline reproduction. Python: numpy, shapely, pyproj, rasterio.
Exact 2014-to-2024 gross natural-vegetation -> developed pixel transitions.
Natural classes: 41,42,43,52,71,90,95; developed: 21,22,23,24.
Boundary-edge pixels are weighted by geometric intersection area.
"""
import json,pathlib,csv,zipfile,io
import shapefile
import numpy as np
import rasterio
from rasterio.features import rasterize
from shapely.geometry import shape,mapping
from shapely.ops import transform,unary_union
import shapely
from pyproj import Transformer
R=pathlib.Path(__file__).parent;raw=R/'raw'
N=[41,42,43,52,71,90,95];D=[21,22,23,24]
with rasterio.open(raw/'landcover-2014.tif') as src:
 a=src.read(1);t=src.transform;crs=src.crs;profile=src.profile
with rasterio.open(raw/'landcover-2024.tif') as src:
 assert src.transform==t and src.crs==crs and src.shape==a.shape
 b=src.read(1)
assert np.array_equal(a==0,b==0), 'Missing-data masks differ by year'
assert np.isclose(t.a,30) and np.isclose(t.e,-30)
assert set(np.unique(a)) <= {0,11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95}
proj=Transformer.from_crs(4326,crs,always_xy=True).transform
z=zipfile.ZipFile(raw/'tl_2026_06053_faces.zip')
def member(ext): return io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(ext))))
faces=shapefile.Reader(shp=member('.shp'),shx=member('.shx'),dbf=member('.dbf'))
water=unary_union([transform(proj,shape(sr.shape.__geo_interface__)) for sr in faces.iterShapeRecords() if sr.record['LWFLAG']=='P'])
results={};rows=[]
for region,fn in [('carmel','carmel-lafco-boundary.json'),('monterey-county','monterey-census-boundary.json'),('carmel-census-crosscheck','carmel-census-boundary.json')]:
 g=unary_union([transform(proj,shape(f['geometry'])) for f in json.loads((raw/fn).read_text())['features']])
 jurisdiction_total_area=g.area
 g=g.difference(water)
 center=rasterize([(mapping(g),1)],out_shape=a.shape,transform=t,dtype='uint8')
 edge=rasterize([(mapping(g.boundary),1)],out_shape=a.shape,transform=t,all_touched=True,dtype='uint8')
 weights=center.astype('float64');ri,ci=np.where(edge)
 x=t.c+ci*30;y=t.f-ri*30
 boxes=shapely.box(x,y-30,x+30,y)
 weights[ri,ci]=shapely.area(shapely.intersection(boxes,g))/900
 assert abs(weights.sum()*900-g.area)<max(.01,g.area*1e-8),(region,weights.sum()*900,g.area)
 np.savez_compressed(R/f'{region}-boundary-weights.npz',weights=weights,center=center)
 covered=weights>0;valid=(a>0)&(b>0);nodata=float(weights[covered&~valid].sum()*900)
 assert nodata<1,(region,nodata)
 nat=np.isin(a,N);dev=np.isin(b,D)
 baseline=float(weights[nat].sum()*900);converted=float(weights[nat&dev].sum()*900)
 rate=converted/baseline*100
 nat31=np.isin(a,N+[31,12]);base31=float(weights[nat31].sum()*900);conv31=float(weights[nat31&dev].sum()*900)
 centernat=int(np.sum(center&nat));centerconv=int(np.sum(center&nat&dev))
 results[region]={'baseline_year':2014,'end_year':2024,'period_years':10,'natural_class_codes':N,'developed_class_codes':D,'boundary_area_m2':g.area,'raster_weighted_boundary_area_m2':float(weights.sum()*900),'nodata_inside_m2':nodata,'baseline_natural_m2':baseline,'converted_natural_to_developed_m2':converted,'baseline_natural_ha':baseline/10000,'converted_ha':converted/10000,'value_pct_per_decade':rate,'baseline_natural_effective_pixels':baseline/900,'converted_effective_pixels':converted/900,'baseline_natural_center_pixels':centernat,'converted_center_pixels':centerconv,'pixel_center_rate_sensitivity_pct':centerconv/centernat*100,'including_barren_31_and_snow_12_sensitivity':{'baseline_m2':base31,'converted_m2':conv31,'rate_pct':conv31/base31*100},'baseline_class_area_m2':{str(c):float(weights[a==c].sum()*900) for c in np.unique(a) if float(weights[a==c].sum())>0},'gross_conversion_by_baseline_class_m2':{str(c):float(weights[(a==c)&dev].sum()*900) for c in N},'gross_conversion_by_developed_end_class_m2':{str(c):float(weights[nat&(b==c)].sum()*900) for c in D}}
 for c in N:
  for d in D:
   rows.append({'region':region,'baseline_class':c,'end_class':d,'converted_m2':float(weights[(a==c)&(b==d)].sum()*900)})
 if region in ['carmel','monterey-county']:
  converted_centers=(center&nat&dev).astype('uint8')
  out=profile.copy();out.update(dtype='uint8',count=1,compress='lzw',nodata=255)
  with rasterio.open(R/f'{region}-conversion-mask.tif','w',**out) as dest: dest.write(np.where(center,converted_centers,255).astype('uint8'),1)
 print(region,json.dumps(results[region]),flush=True)
(R/'results.json').write_text(json.dumps(results,indent=2))
with (R/'transitions.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
