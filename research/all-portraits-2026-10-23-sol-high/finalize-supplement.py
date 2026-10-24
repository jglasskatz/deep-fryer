from pathlib import Path
import json,hashlib,gzip,csv,io
B=Path(__file__).resolve().parent;p=B/'findings/supplemental-housing.json';j=json.loads(p.read_text());manifest={}
meta=json.loads((B/'activity/acs5-shells2024.json').read_text());raw=gzip.decompress((B/meta['stored_path']).read_bytes());labels=[r for r in csv.DictReader(io.StringIO(raw.decode()),delimiter='|') if r['Table ID']=='B25070']
(B/'calculations/rentburden-official-labels.json').write_text(json.dumps(labels,indent=2)+'\n')
for a in j['amendments']:
 if not any(s['url']==meta['url'] for s in a['source_support']):a['source_support'].append({'url':meta['url'],'raw_path':meta['stored_path'],'raw_sha256':meta['sha256'],'stored_sha256':meta['stored_sha256'],'raw_encoding':meta['storage_encoding'],'captured_at':meta['captured_at'],'period':'2024 ACS table shell labels','scale':'table definitions'})
 for s in a['source_support']:
  for field in ['raw_path','snapshot_path']:
   if not s.get(field):continue
   f=B/s[field];data=f.read_bytes();sha=hashlib.sha256(data).hexdigest();manifest[s[field]]={'sha256':sha,'bytes':len(data),'role':field}
   if field=='snapshot_path':s['snapshot_sha256']=sha
   elif f.suffix=='.gz':assert hashlib.sha256(gzip.decompress(data)).hexdigest()==s['raw_sha256'];s['stored_sha256']=sha
   else:assert sha==s['raw_sha256']
 (B/'findings'/(a['id'].replace(':','--')+'.json')).write_text(json.dumps(a,indent=2,ensure_ascii=False)+'\n')
p.write_text(json.dumps(j,indent=2,ensure_ascii=False)+'\n');(B/'supplemental-evidence-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(hashlib.sha256(p.read_bytes()).hexdigest())
