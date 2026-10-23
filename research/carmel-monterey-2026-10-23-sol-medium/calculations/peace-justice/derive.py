import csv, json, pathlib, html
base=pathlib.Path(__file__).parent
rows=[r for r in csv.DictReader((base/'Crimes_and_Clearances_with_Arson-1985-2025.csv').open()) if r['County']=='Monterey County' and r['Year']=='2025']
assert len(rows)==18
cols=['Homicide_sum','ForRape_sum','Robbery_sum','AggAssault_sum']
for r in rows:
    assert r['Violent_sum']!='' and all(r[k]!='' for k in cols)
    assert int(r['Violent_sum'])==sum(int(r[k]) for k in cols)
city=next(r for r in rows if r['NCICCode']=='Carmel')
results={}
for name,n,p in [('carmel',int(city['Violent_sum']),3115),('monterey-county',sum(int(r['Violent_sum']) for r in rows),437465)]:
    rate=n/p*1000
    results[name]={'year':2025,'violent_crimes':n,'population_january_1_2025':p,'rate_per_1000':rate,'target':4,'level_pct':(rate-4)/4*100}
(base/'results.json').write_text(json.dumps(results,indent=2)+'\n')
url='https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2026-07/Crimes_and_Clearances_with_Arson-1985-2025.csv'
headers=['Reporting agency (NCICCode)','Violent total','Homicide','Rape','Robbery','Aggravated assault']
body=''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in [r['NCICCode'],r['Violent_sum']]+[r[k] for k in cols])+'</tr>' for r in rows)
sums=[sum(int(r[k]) for r in rows) for k in ['Violent_sum']+cols]
doc='''<!DOCTYPE html><html><meta charset="utf-8"><style>body{font:18px Arial;padding:30px;color:#18212b;max-width:1200px}table{border-collapse:collapse;width:100%;font-size:17px}td,th{padding:8px;border:1px solid #b3bec9;text-align:right}td:first-child,th:first-child{text-align:left}th{background:#e8f0f7}tr:last-child{font-weight:bold;background:#e8f0f7}p{line-height:1.4;overflow-wrap:anywhere}h1{font-size:29px}</style><h1>California DOJ Crimes and Clearances: Monterey County, 2025</h1>'''
doc+='<p>Faithful researcher-produced extract of all 18 source CSV rows where Year = 2025 and County = Monterey County. This view is an extract, not a DOJ-published table. Source: '+url+'</p><table><tr>'+''.join('<th>'+x+'</th>' for x in headers)+'</tr>'+body+'<tr><td>Derived county sum (18 agency rows)</td>'+''.join('<td>'+str(x)+'</td>' for x in sums)+'</tr></table>'
doc+='<p>Violent_sum = Homicide_sum + ForRape_sum + Robbery_sum + AggAssault_sum. All values shown are reported counts, not estimates or arrests. Special-jurisdiction agencies are included in the county sum.</p><p>Derived resident rates using California Department of Finance revised January 1, 2025 population (E-1, May 2026, PDF page 8): Carmel-by-the-Sea: 3 / 3,115 × 1,000 = '+str(results['carmel']['rate_per_1000'])+'; all Monterey County: 1,846 / 437,465 × 1,000 = '+str(results['monterey-county']['rate_per_1000'])+'.</p><p>The June 2026 DOJ README reports no Monterey County agency among 2025 reporting limitations. The City identifies its Police Department jurisdiction as city limits. Rates use resident population; visitors and unreported crimes are not measured.</p></html>'
(base/'source-extract.html').write_text(doc)
print(json.dumps(results,indent=2))
