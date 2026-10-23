"""Offline derivation: python3 derive.py. Uses archived public CDC bytes only."""
from pathlib import Path
import csv, hashlib, html, io, json, zipfile

BASE = Path(__file__).resolve().parent
RAW = BASE / 'raw'
archive = RAW / 'EJI_2024_California_CSV.zip'
with zipfile.ZipFile(archive) as z:
    rows = list(csv.DictReader(io.StringIO(z.read('EJI_2024_California.csv').decode('utf-8-sig'))))
    dictionary = list(csv.reader(io.StringIO(z.read('EJI_DATADICTIONARY_2024.csv').decode('cp1252'))))
tracts = sorted((r for r in rows if r['STATEFP'] == '06' and r['COUNTYFP'] == '053'), key=lambda r: r['GEOID'])
assert len(tracts) == 103
assert len(set(r['GEOID'] for r in tracts)) == len(tracts)
assert all(float(r['E_NEHD']) >= 0 and float(r['E_TOTPOP']) >= 0 for r in tracts)
# Coverage audit uses independently archived Census 2020 TIGER responses.
coverage_dir = BASE / 'reviewer-coverage'
coverage_manifest = json.loads((coverage_dir / 'manifest.json').read_text())
coverage_files = [coverage_dir / m['file'] for m in coverage_manifest]
assert all(hashlib.sha256((coverage_dir / m['file']).read_bytes()).hexdigest() == m['sha256']
           for m in coverage_manifest)
coverage_responses = [json.loads(p.read_text()) for p in coverage_files]
county_responses = [j for j in coverage_responses if len(j.get('features', [])) == 104]
water_responses = [j for j in coverage_responses if len(j.get('features', [])) == 1
                   and j['features'][0]['attributes'].get('GEOID') == '06053990000'
                   and 'POP100' in j['features'][0]['attributes']]
assert len(county_responses) >= 1 and len(water_responses) >= 1
census = {f['attributes']['GEOID']: f['attributes'] for f in county_responses[0]['features']}
eji_ids = {r['GEOID'] for r in tracts}
assert set(census) - eji_ids == {'06053990000'}
assert not eji_ids - set(census)
water = water_responses[0]['features'][0]['attributes']
assert int(water['POP100']) == 0 and int(water['HU100']) == 0
assert float(water['AREALAND']) == 0 and float(water['AREAWATER']) == 1141754797
coverage_note = ('All 103 Monterey County tracts included in CDC EJI 2024; Census 2020 lists '
                 '104 county tracts, with water-only zero-population tract 06053990000 absent '
                 'from EJI. The remaining 103 cover the county resident land geography. '
                 'No residents are removed by this water-tract omission.')
service = {f['attributes']['GEOID']: f['attributes'] for f in json.loads((RAW / 'monterey-tract-heat.json').read_text())['features']}
assert len(service) == len(tracts)
assert all(float(r['E_NEHD']) == service[r['GEOID']]['E_NEHD'] and float(r['E_TOTPOP']) == service[r['GEOID']]['E_TOTPOP'] for r in tracts)
denominator = sum(float(r['E_TOTPOP']) for r in tracts)
numerator = sum(float(r['E_TOTPOP']) * float(r['E_NEHD']) for r in tracts)
result = dict(tract_count=len(tracts), census_2020_tract_count=len(census),
              omitted_water_tract='06053990000', coverage_note=coverage_note,
              population_weight_total=denominator,
              weighted_days_population_sum=numerator, value=numerator / denominator,
              displayed_value=round(numerator / denominator, 1), period='2018–2022',
              unit='population-weighted mean days/year',
              tract_min=min(float(r['E_NEHD']) for r in tracts),
              tract_max=max(float(r['E_NEHD']) for r in tracts),
              source_archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
(BASE / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
with (BASE / 'monterey-inputs.csv').open('w') as f:
    w=csv.writer(f); w.writerow(['GEOID','E_TOTPOP','E_NEHD','population_times_days'])
    for r in tracts: w.writerow([r['GEOID'],r['E_TOTPOP'],r['E_NEHD'],float(r['E_TOTPOP'])*float(r['E_NEHD'])])
dictrows = [r for r in dictionary if r[0] in ['E_TOTPOP','E_NEHD']]
render_rows = ''.join('<tr><td>' + '</td><td>'.join(html.escape(x) for x in [r[0],r[2],r[5]]) + '</td></tr>' for r in dictrows)
exhibit = f'''<!doctype html><meta charset="utf-8"><title>Derived Monterey County extreme heat exposure</title>
<style>body{{font:20px/1.45 system-ui;max-width:1100px;margin:48px auto;color:#172331}}h1{{font-size:34px}}h2{{font-size:25px}}table{{border-collapse:collapse;width:100%;font-size:16px}}td,th{{border:1px solid #aab5c3;padding:12px;text-align:left}}.metric{{font-size:45px;font-weight:700}}code{{font-size:17px;overflow-wrap:anywhere}}a{{overflow-wrap:anywhere}}</style>
<h1>Monterey County extreme heat exposure</h1><p>Researcher-derived summary of official CDC/ATSDR EJI 2024 historical data. This is an unscored observation.</p>
<div class="metric">{result['displayed_value']} days/year</div><p>Population-weighted mean of tract annual averages, <b>2018–2022</b>. {coverage_note} In Carmel's preview this is county context, not a city measurement.</p>
<h2>Reproducible calculation</h2><p>Sum(E_NEHD × E_TOTPOP) / sum(E_TOTPOP)<br>{numerator:,.1f} / {denominator:,.0f} = {result['value']:.10f} days/year.</p>
<p>Tract annual means range from {result['tract_min']} to {result['tract_max']} days/year. Weights are 2018–2022 ACS population estimates included in EJI. No missing or negative inputs; the data service and downloadable CSV agree for all 103 tracts.</p>
<h2>Independent geography coverage check</h2><p>Census 2020 TIGER lists 104 county tract IDs; EJI contains 103 of them and no additional IDs. The omitted tract, Census Tract 9900 (06053990000), has population 0, housing units 0, land area 0 m², and water area 1,141,754,797 m². This is an observed membership difference; no CDC removal policy is inferred. Archived Census query responses and SHA-256 hashes are retained in reviewer-coverage/.</p>
<h2>Official dictionary extract (verbatim fields)</h2><table><tr><th>Field</th><th>Definition</th><th>Provenance</th></tr>{render_rows}</table>
<p>EJI technical documentation, pp. 93–94: E_NEHD is the sum of tract-specific extreme heat days over 2018–2022 divided by five; heat values were crosswalked from 2010 to 2020 tracts. Thirteen tracts nationally were interpolated; local interpolation status is not separately identified. The heat entry does not state the historical baseline years or seasonal window.</p>
<p>This summary describes exposure to locally unusual maximum temperatures. It is not an absolute-temperature or heat-index threshold, NWS HeatRisk, a count of simultaneous countywide events, or a future projection. Relative extreme-heat definitions differ from local Cal-Adapt definitions.</p>
<h2>Scoring</h2><p>No adopted or scientific safe annual-day target was established. Target, level_pct and scoring remain null. A percentile identifies unusually hot days; it does not define a safe annual number of such days.</p>
<p>Official source: <a href="https://eji.cdc.gov/Documents/Data/2024/2024_CSV/EJI_2024_California_CSV.zip">CDC EJI 2024 California CSV package</a><br>Archive SHA-256: <code>{result['source_archive_sha256']}</code></p>
<p>Method: <a href="https://atsdr.cdc.gov/place-health/media/pdfs/2024/10/EJI_2024_Technical_Documentation.pdf">CDC EJI 2024 Technical Documentation</a>. Accessed 2026-10-23. Offline reproduction: derive.py; full input table: monterey-inputs.csv.</p>'''
(BASE / 'source-extract.html').write_text(exhibit)
print(json.dumps(result, indent=2))
