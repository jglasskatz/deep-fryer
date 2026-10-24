from pathlib import Path
import json,hashlib,gzip,copy
B=Path(__file__).resolve().parent
p=B/'findings/amendments.json';j=json.loads(p.read_text());evidence={}
for a in j['amendments']:
 for s in a['source_support']:
  for field in ['raw_path','snapshot_path','pdf_path']:
   if not s.get(field):continue
   f=(B/s[field]).resolve();assert f.exists(),(a['id'],field,f)
   data=f.read_bytes();key=s[field];actual=hashlib.sha256(data).hexdigest()
   if field=='raw_path' and f.suffix=='.gz':
    assert hashlib.sha256(gzip.decompress(data)).hexdigest()==s['raw_sha256'];s['stored_sha256']=actual
   elif field=='raw_path':assert actual==s['raw_sha256'],(a['id'],s[field])
   elif field=='snapshot_path':s['snapshot_sha256']=actual
   evidence[key]={'sha256':actual,'bytes':len(data),'role':field}
 a['field_diff']={k:{'before':(a['before'] or {}).get(k),'after':v} for k,v in a['after'].items() if (a['before'] or {}).get(k)!=v}
 # atomic, separately addressable research records; no self-verification verdict.
 name=a['id'].replace(':','--')+'.json';(B/'findings'/name).write_text(json.dumps(a,indent=2,ensure_ascii=False)+'\n')
p.write_text(json.dumps(j,indent=2,ensure_ascii=False)+'\n')
(B/'evidence-manifest.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps({'claims':len(j['amendments']),'manifest_files':len(evidence),'amendments_sha256':hashlib.sha256(p.read_bytes()).hexdigest()},indent=2))
