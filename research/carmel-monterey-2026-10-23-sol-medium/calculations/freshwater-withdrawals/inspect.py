"""Reproduce coverage inspection; no jurisdiction rate or score is calculated."""
import csv, hashlib, json
from pathlib import Path
base = Path(__file__).resolve().parent
source = base / 'raw/urban-supplier-monthly.csv'
rows = list(csv.DictReader(source.open()))
county_rows = [r for r in rows if 'MONTEREY' in r['COUNTY'].upper()]
fields = ['SUPPLIER_NAME','WATER_SYSTEM_ID','COUNTY','REPORT_PERIOD_START_DATE','REPORT_PERIOD_END_DATE','POP_REPORT_PERIOD','POTABLE_DEMAND_RES_GAL','R-GPCD','RES_FLAG']
suppliers=[]
for name in sorted({r['SUPPLIER_NAME'] for r in county_rows}):
    rr = [r for r in county_rows if r['SUPPLIER_NAME'] == name]
    latest = max(rr, key=lambda r:r['REPORT_PERIOD_START_DATE'])
    suppliers.append({'number_of_reports':len(rr), 'latest_report':{k:latest[k] for k in fields}})
result={'source_path':'raw/urban-supplier-monthly.csv','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'filter':'COUNTY contains MONTEREY, case insensitive','county_report_count':len(county_rows),'supplier_count':len(suppliers),'suppliers':suppliers,'interpretation':'Supplier service areas are the reporting units. COUNTY is a label, not a complete county resident denominator. Six urban suppliers do not establish coverage of small systems and self-supplied residents. CalAm Monterey District cannot be disaggregated to Carmel city limits from these columns. No indicator or score derived.'}
(base/'coverage-inspection.json').write_text(json.dumps(result,indent=2)+'\n')
