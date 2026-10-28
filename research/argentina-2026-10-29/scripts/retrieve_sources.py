#!/usr/bin/env python3
"""Retrieve exact official source bytes; append immutable manifest (no invented observations)."""
import concurrent.futures, datetime, fcntl, hashlib, json, pathlib, sys, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'data/sources.json'
def fetch(spec):
 sid,url,name,publisher,release=spec
 try:
  req=urllib.request.Request(url, headers={'User-Agent':'ArgentinaResearch/1.0 (source archive)'})
  with urllib.request.urlopen(req,timeout=90) as r:
   raw=r.read(); resolved=r.url; headers=dict(r.headers)
  dest=ROOT/'raw'/name
  if dest.exists() and dest.read_bytes()!=raw:raise ValueError('Archive conflict: refusing to overwrite existing source bytes; create a new dated snapshot')
  dest.write_bytes(raw)
  return {'id':sid,'url':url,'resolved_url':resolved,'path':'raw/'+name,'publisher':publisher,'release_date':release,'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'content_type':headers.get('Content-Type'), 'http_last_modified':headers.get('Last-Modified')}
 except Exception as e:
  return {'id':sid,'url':url,'error':str(e)}
def main(specs):
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
  for item in pool.map(fetch,specs):
   print(item['id'],item.get('bytes',item.get('error')))
   if 'error' not in item:
    records=ROOT/'data/source-records'; records.mkdir(exist_ok=True)
    (records/(item['id']+'.json')).write_text(json.dumps(item,indent=2,ensure_ascii=False)+'\n')
    with (ROOT/'data/.manifest.lock').open('w') as lock:
     fcntl.flock(lock, fcntl.LOCK_EX)
     old=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
     byid={x['id']:x for x in old}; byid[item['id']]=item
     MANIFEST.write_text(json.dumps(list(byid.values()),indent=2,ensure_ascii=False)+'\n')
if __name__=='__main__':
 codes=['SP.DYN.LE00.IN','SH.DYN.MORT','EG.ELC.ACCS.ZS','IT.NET.USER.ZS','SL.UEM.TOTL.ZS','SI.POV.GINI','NY.GDP.PCAP.KD','SH.H2O.BASW.ZS','SH.STA.BASS.ZS','AG.LND.FRST.ZS','EN.GHG.CO2.PC.CE.AR5','EN.ATM.PM25.MC.M3','EG.FEC.RNEW.ZS','SP.POP.TOTL']
 specs=[]
 for code in codes:
  specs.append(('wdi-'+code,'https://api.worldbank.org/v2/country/ARG/indicator/'+code+'?format=json&per_page=100&date=2013:2026','wdi-'+code+'.json','World Bank WDI',None))
  specs.append(('wdi-meta-'+code,'https://api.worldbank.org/v2/indicator/'+code+'?format=json','wdi-meta-'+code+'.json','World Bank WDI',None))
 specs.extend([
 ('indec-poverty-topic','https://www.indec.gob.ar/indec/web/Nivel3-Tema-4--46','indec-poverty-topic.html','INDEC',None),
 ('indec-poverty-series','https://www.indec.gob.ar/indec/web/Nivel4-Tema-4-46-152','indec-poverty-series.html','INDEC',None),
 ('indec-cpi-topic','https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31','indec-cpi-topic.html','INDEC',None),
 ('indec-reservations','https://www.indec.gob.ar/indec/web/Institucional-Indec-InformacionDeArchivo-2','indec-reservations.html','INDEC',None),
 ('indec-poverty-2025h1','https://www.indec.gob.ar/uploads/informesdeprensa/eph_pobreza_09_25D162CC7BFB.pdf','indec-poverty-2025h1.pdf','INDEC','2025-09-25'),
 ('gcb-2025-object','https://meta.icos-cp.eu/objects/loCXyssaalv6DPdO6Qdj90qQ','gcb-2025-object.html','ICOS / Global Carbon Project',None),
 ('gcb-2025-workbook','https://data.icos-cp.eu/objects/loCXyssaalv6DPdO6Qdj90qQ','gcb-2025-national-fossil.xlsx','Global Carbon Project / ICOS',None),
 ('gcb-2025-paper','https://essd.copernicus.org/articles/18/3211/2026/essd-18-3211-2026.pdf','gcb-2025-paper.pdf','Friedlingstein et al. / Earth System Science Data','2026-05-13'),
 ])
 main(specs)
