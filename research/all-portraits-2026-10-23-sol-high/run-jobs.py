import json,subprocess,sys,concurrent.futures
from pathlib import Path
b=Path(__file__).resolve().parent
jobs=json.load(open(b/(sys.argv[1] if len(sys.argv)>1 else 'jobs.json')))
def run(job):
 r=subprocess.run(['node',str(b/'capture.mjs'),*job],capture_output=True,text=True)
 return {'job':job,'returncode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(run,jobs):print(json.dumps(result),flush=True)
