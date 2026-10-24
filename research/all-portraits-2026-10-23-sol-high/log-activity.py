from pathlib import Path
import json,datetime,collections
B=Path(__file__).resolve().parent
calls=[
('434',['site.health.ny.gov 2025 "new_york_city_compliance_report"','site.nyc.gov "2025" "drinking-water-supply-quality-report" violations'],0,0,0,0),
('435',[],3,0,0,0),
('436',['site:health.ny.gov "New York City" "2025" "Violations" drinking water','site:nyc.gov "2025" "Drinking Water" "violations"','site:nyc.gov "2024" "Drinking Water" "violation" filtration'],0,0,0,0),
('437',[],3,0,0,0),('438',[],0,2,0,0),
('439',['site:www2.census.gov 2024 "GCT1701" "csv"','site:census.gov "GCT1903" "Gini"','site:santacruzca.gov 2024 greenhouse gas inventory 2022 2023','site:watsonville.gov 2024 water quality report nitrate violations'],0,0,0,0),
('440',[],2,0,0,0),
('441',['site:housingforhealthpartnership.org "2025" "Watsonville" "Point"','site:santacruzcountyca.gov "2025" "point-in-time"','site:santacruzca.gov "2025" "PIT" 2025 2026'],0,2,0,0),
('442',[],1,0,0,0),
('443',['site:ambag.org Monterey County 2022 greenhouse gas emissions inventory 2023 all jurisdictions','site:countyofmonterey.gov greenhouse gas inventory "2022" "incorporated"','site:carmelca.gov "water" "2024" "residential" gallons'],0,1,0,0),
('444',[],1,0,0,0),('445',[],1,0,1,0),('446',[],0,1,0,0),('447',[],0,2,0,0),
('448',['site:www2.census.gov "2024" "B19083" "5-Year"','site:census.gov "table-based" "2024" summary file download'],0,0,0,0),
('449',[],1,0,2,0),('450',[],1,0,0,0),('451',[],0,0,0,2),
('452',['site:ci.carmel.ca.us "California American Water" "entire"','site:ci.carmel.ca.us "water" "service" "Monterey" "city"','site:amwater.com "2025" "Monterey" "Water Quality"','site:countyofmonterey.gov "2025" "all" "greenhouse gas" inventory'],0,0,0,0)]
records=[{'tool_result_prefix':'turn'+n,'exact_search_queries':q,'open_requests':o,'click_requests':c,'find_requests':f,'screenshot_requests':s} for n,q,o,c,f,s in calls]
(B/'searches/web-queries.json').write_text(json.dumps({'scope':'This new high-effort researcher session only; tool-result prefixes identify the session outputs. Browser request/exhibit logs are separate.','calls':records},indent=2)+'\n')
activity=[]
for p in (B/'activity').glob('*.json'):
 try:r=json.load(open(p))
 except Exception:continue
 if r.get('mode'):activity.append(r)
counts=collections.Counter(r['mode'] for r in activity)
(B/'activity/summary.json').write_text(json.dumps({'model':'gpt-6.1-sol','reasoning_effort':'high','portraits_inventoried':11,'web_tool_calls':len(records),'search_queries':sum(len(r['exact_search_queries']) for r in records),'web_open_requests':sum(r['open_requests'] for r in records),'web_click_requests':sum(r['click_requests'] for r in records),'web_find_requests':sum(r['find_requests'] for r in records),'web_screenshot_requests':sum(r['screenshot_requests'] for r in records),'browser_unique_logged_requests':len(activity),'browser_requests_by_mode':dict(counts),'browser_success_records':sum(r.get('success') is True for r in activity),'browser_failure_records':sum(r.get('success') is False for r in activity),'additional_exhibit_render_attempts':8,'additional_curl_download_failures':3,'notes':'Eight initial exhibit renders were refreshed for readable prose; their latest records replaced initial render metadata, so eight additional successful render attempts are explicitly added. Three failed curl download attempts are preserved separately. A failed browser launch is also retained. These are research activity counts, not API billing telemetry. Official large DAT tables are gzip-compressed without changing any decompressed source byte.','actual_tokens':None,'actual_billed_usd':None,'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
print((B/'activity/summary.json').read_text())
