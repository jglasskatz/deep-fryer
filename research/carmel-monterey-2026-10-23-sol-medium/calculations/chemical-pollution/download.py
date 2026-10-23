"""Refetch official source bytes. Revisions may change hashes; inspect sha256.json."""
from pathlib import Path
import subprocess,json
BASE=Path(__file__).resolve().parent
sources={
 'basic-page.html':'https://www.epa.gov/toxics-release-inventory-tri-program/tri-basic-data-files-calendar-years-1987-present',
 '2024_CA.csv':'https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/2024_CA/csv',
 'co-est2025-alldata.csv':'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv',
 'sub-est2025.csv':'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv'}
for record in json.loads((BASE/'raw/boundary-provenance.json').read_text()):sources[record['file']]=record['url']
if __name__=='__main__':
 for filename,url in sources.items():
  subprocess.run(['curl','--fail','--location','--silent','--show-error','--max-time','90',url,'-o',str(BASE/'raw'/filename)],check=True)
