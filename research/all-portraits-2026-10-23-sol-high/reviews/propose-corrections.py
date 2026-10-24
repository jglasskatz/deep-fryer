"""Reviewer-suggested corrections; these require a different agent's review."""
from pathlib import Path
import copy, csv, hashlib, html, io, json, re, subprocess

B=Path(__file__).resolve().parent.parent
H=lambda b:hashlib.sha256(b).hexdigest()
frozen=B/'findings/amendments.json'
assert H(frozen.read_bytes())=='8a4f14c2b14a2ac501f3eb884819bd74c134abf3b4283d6bc7936001ab69866a'
original=json.loads(frozen.read_text())
byid={r['id']:r for r in original['amendments']}
css='body{font:20px/1.5 system-ui;max-width:1120px;margin:44px auto;color:#152638}table{border-collapse:collapse;width:100%;font-size:18px}td,th{border:1px solid #abc;padding:12px;text-align:left}pre{white-space:pre-wrap;font-size:17px}h1{font-size:32px}'
def table(headers,rows):
    return '<table><tr>'+''.join('<th>'+html.escape(str(x))+'</th>' for x in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in row)+'</tr>' for row in rows)+'</table>'
def exhibit(stem,title,body):
    content='<!doctype html><html><head><meta charset="utf-8"><title>'+html.escape(title)+'</title><style>'+css+'</style></head><body><h1>'+html.escape(title)+'</h1><p>Reviewer-generated extract from frozen publisher bytes. This is a derived research exhibit, not a publisher-authored table. Original source URLs and SHA-256 bindings accompany each amendment.</p>'+body+'</body></html>'
    (B/'calculations'/f'{stem}.html').write_text(content)

conservation_rows=[('Bronx',30863,5646),('Kings',52820,12804),('New York',20528,2735),('Queens',80102,14071),('Richmond',37869,8118)]
area=sum(r[1] for r in conservation_rows);protected=sum(r[2] for r in conservation_rows)
exhibit('reviewer-conservation-corrected','NYC reported protected land and water, 2023',table(['County','Reported total area (acres)','Protected land and water (acres)'],conservation_rows)+f'<p>{protected:,} protected acres / {area:,} reported total acres × 100 = <strong>{protected/area*100:.8f}%</strong>, rounding to 19.5%.</p><p>The publisher labels these percentages as county lands and waters protected. This aggregate is not the framework land-only share. No land-only 30% target or score is asserted. Protection categories also differ in management and ecological quality.</p>')
gctrows=list(csv.DictReader(io.StringIO((B/'raw/broadband-2024-comparison.csv').read_bytes().decode('cp1252'))))
county=next(r for r in gctrows if r['GEOID']=='0500000US06087')
assert float(county['ESTIMATE'])==94.9 and county['MG_ERROR']=='+/-1.1'
exhibit('reviewer-county-broadband-corrected','Santa Cruz County broadband of any type, ACS 2024 one-year',table(['Geography','GEO_ID','Estimate','90% margin of error'],[('Santa Cruz County, California',county['GEOID'],county['ESTIMATE']+'%',county['MG_ERROR']+' percentage points')])+'<p>Source: U.S. Census Bureau, ACS 2024 one-year Geographic Comparison Table GCT2801. This is the share of households with a broadband subscription of any type, including cellular-only. It is not fixed cable/fiber/DSL access alone, service quality, speed or affordability. The city observations elsewhere use ACS 2020–2024 five-year estimates; their periods differ.</p><p>Exact original publisher CSV row:</p><pre>'+html.escape(json.dumps(county,indent=2))+'</pre><p>No target or score is asserted.</p>')
pdf=B/'../../site/evidence/shared/e89455fc53fef9ac48a438f1.pdf'
text=subprocess.check_output(['pdftotext','-layout',str(pdf),'-'],stderr=subprocess.DEVNULL).decode()
assert re.search(r'Bronx\s+28\.9%\s+63\.3%',text)
assert re.search(r'Staten Island\s+13\.3%\s+76\.5%',text)
assert 'refers to fixed broadband' in text
exhibit('reviewer-fixed-broadband-corrected','Bronx and Staten Island fixed broadband, 2023',table(['Borough','Fixed broadband','Cellular data only','No internet'],[('Bronx','63.3%','20.3%','7.1%'),('Staten Island','76.5%','12.0%','6.3%')])+'<p>Exact 2023 columns from Figure 4, Household Poverty and Internet Access Status, NYS Office of the State Comptroller Report 20-2025 (December 2024), printed page 5. The publisher attributes estimates to ACS one-year files and OSC analysis. The report generally defines broadband as fixed cable, fiber to the premises, or DSL and separates cellular-only service.</p><p>These are related fixed-broadband observations, not estimates of broadband of any type. No target or score is applied. The generic broadband-access contract and its local target require a separate decision before a fixed-only score can be asserted.</p>')

jobs=[['render',f'calculations/{stem}.html',stem] for stem in ['reviewer-conservation-corrected','reviewer-county-broadband-corrected','reviewer-fixed-broadband-corrected']]
(B/'reviews/correction-render-jobs.json').write_text(json.dumps(jobs,indent=2)+'\n')
print('Created three new reviewer extract HTML inputs; originals unchanged. Render before finalizing corrections.')
