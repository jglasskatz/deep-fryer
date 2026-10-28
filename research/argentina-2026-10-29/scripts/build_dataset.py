#!/usr/bin/env python3
"""Deterministic extraction from archived source bytes. No network, interpolation or policy-effect inference.
Requires xlrd==2.0.2 and openpyxl==3.1.5 (see README for a temporary install).
"""
import calendar,csv,datetime,hashlib,html,json,pathlib,re,sys
sys.path.insert(0,'/private/tmp/argentina-research-deps')
import xlrd,openpyxl
ROOT=pathlib.Path(__file__).resolve().parents[1]
RAW=ROOT/'raw'; DATA=ROOT/'data'
def read(name):return json.loads((RAW/name).read_text())
HUMAN_KEYS={'title','label','coverage','name','target_rationale','comparability_notes','confidence_locator','missing_reason','version_note','format_note','use_restriction','observation_scope','do_not_splice','baseline','post_window','turning_point_status','doughnut_scope','causal_status','target_version','missing_data_policy','date_precision'}
def spaced(text):
 protected=['PM2.5','EPHC-S2','H1','H2','CO2','COVID-19','SDG6.4.2','SDG7']
 for n,t in enumerate(protected):text=text.replace(t,'§'+chr(65+n)+'§')
 text=text.replace('printedp','printed p.').replace('printedpp','printed pp.')
 text=re.sub(r'(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])',' ',text)
 text=re.sub(r'(?<=[A-Za-z]),(?=\d)',', ',text)
 text=re.sub(r'(?<=[a-z])\.(?=\d{4}\b)', '. ',text)
 text=re.sub(r'(?<=[A-Za-z%]),(?=[A-Za-z])',', ',text)
 for n,t in enumerate(protected):text=text.replace('§'+chr(65+n)+'§',t)
 return text
def humanize(value,key=None):
 if isinstance(value,dict):return {k:humanize(v,k) for k,v in value.items()}
 if isinstance(value,list):return [humanize(v,key) for v in value]
 return spaced(value) if isinstance(value,str) and key in HUMAN_KEYS else value
def write(name,value):(DATA/name).write_text(json.dumps(humanize(value),indent=2,ensure_ascii=False,allow_nan=False)+'\n')
sources=json.loads((DATA/'sources.json').read_text())
# The ICOS endpoint returned a licence page, never a workbook. Keep it as documented access evidence.
for s in sources:
 if (s.get('content_type') or '').startswith('text/html') and s['path'].endswith('.xlsx'):
  old=ROOT/s['path']; new=old.with_suffix('.access.html')
  if old.exists():old.rename(new)
  s['path']=str(new.relative_to(ROOT));s['evidence_status']='access-page-only; not used for numerical extraction'
 if s['id']=='unep-material-argentina-export':
  old=ROOT/s['path'];new=old.with_suffix('.csv')
  if old.exists() and old!=new:old.rename(new)
  s['path']=str(new.relative_to(ROOT));s['format_note']='Publisher export is CSV despite requested filename suffix.'
 s['title']=s.get('title') or s['id'].replace('-',' ')
 titles={'indec-cpi-historical':'INDEC national consumer price index: historical monthly, interannual and price-level tables','indec-cpi-2026sep':'INDEC national consumer price index, September2026 technical report','indec-poverty-fragment':'INDEC income poverty: historical series and methodology notices','pip-argentina-all':'World Bank PIP: Argentina urban EPHC-S2 survey estimates and metadata','event-election2023-act':'National Electoral Board: certification of19November2023 presidential runoff in Neuquen','event-election2015-act':'National Electoral Chamber: certified2015 presidential runoff results','event-dnu70-arca':'Official legislation archive: Decree70/2023','event-bases-normativa':'Official legislation text: Law27,742 (Ley Bases)','event-covid-arca':'Official legislation archive: Decree297/2020 mandatory isolation','event-bcra2023':'BCRA: new monetary and exchange policy framework,12December2023','event-bcra2025-bands':'BCRA: Phase3 exchange liberalization and floating bands,11April2025','event-bcra2026-plan':'BCRA: monetary programme2026 announcement,15December2025','event-bcra-bands-regime':'BCRA: exchange-band regime and January2026 update','event-election2015-consular':'Argentina foreign ministry: historical country brief confirming2015 runoff date','event-imf-bcra':'BCRA: history of Argentina agreements with the IMF','unep-material-methods':'UNEP IRP: Technical Annex for Global Material Flows Database,2024 edition'}
 if s['id'] in titles:s['title']=titles[s['id']]
 if s['id'].startswith('wdi-meta-'):
  code=pathlib.Path(s['path']).stem.removeprefix('wdi-meta-')
  try:s['title']='WDI indicator metadata: '+read('wdi-meta-'+code+'.json')[1][0]['name']
  except (KeyError,IndexError,TypeError):pass
 if s['id'].startswith('wdi-') and not s['id'].startswith('wdi-meta-'):
  try:
   d=json.loads((ROOT/s['path']).read_text());s['title']='WDI Argentina: '+d[1][0]['indicator']['value'];s['dataset_last_updated']=d[0].get('lastupdated')
  except (KeyError,IndexError,TypeError):pass
 if s['id'] in ['indec-cpi-2026sep','indec-cpi-historical']:s['release_date']='2026-10-13'
 if s['id']=='gcb-2025-paper':s['release_date']='2026-05-13'
 if s['id']=='gcb-national-v2025-site':
  s['title']='Global Carbon Budget 2025 national fossil carbon workbook, publisher-site preliminary vintage';s['version_note']='Prepublication GCB2025 publisher-site workbook, retrieved exact bytes; differs from ICOS final v1.0. Do not silently splice vintages.'
 if s['id']=='fanning2021-paper':s['title']='Fanning et al. (2021 online / 2022 issue), The social shortfall and ecological overshoot of nations, Table 1'
 if s['id']=='fanning2021-methods':s['title']='Fanning et al., national Doughnut Supplementary Information'
 if s['id']=='fanning2025-paper':s['title']='Fanning and Raworth (2025), Doughnut of social and planetary boundaries monitors a world out of balance'
 if s['id']=='indec-poverty-2026h1-tables':s['title']='INDEC poverty and indigence, historical tables H2 2016–H1 2026'
 if s['id']=='indec-poverty-2026h1':s['title']='INDEC poverty and indigence in 31 urban agglomerations, H1 2026, Table 1 p.5'
 if s['id']=='unep-material-argentina-export':s['title']='UNEP IRP Global Material Flows Database, Argentina MF/cap and DMC/cap export'
write('sources.json',sources)
S={s['id']:s for s in sources}
COUNTRY={'id':'ARG','name':'Argentina','level':'country','coverage':'National territory/population, according to each producer definition.'}
URBAN={'id':'ARG-EPH31','name':'Argentina: EPH urban survey','level':'urban-survey-domain','coverage':'31 urban agglomerations; not the whole national population. H2 2019 excludes Gran Resistencia; H2 2020 excludes Ushuaia–Rio Grande.'}
GINI_GEO={'id':'ARG-PIP-URBAN','name':'Argentina: urban income survey','level':'urban-survey-domain','coverage':'World Bank PIP reporting_level=urban; EPHC-S2 second-semester income surveys. Not a nationally representative rural+urban distribution.'}
indicators=[];observations=[]
def indicator(id,label,dimension,unit,direction='higher',frequency='annual',geo=COUNTRY,target=None,notes=''):
 d={'id':id,'label':label,'dimension':dimension,'unit':unit,'direction':direction,'frequency':frequency,'geography':geo,'epistemic_type':'estimate','target':target,'target_rationale':None,'comparability_notes':notes}
 if target is not None:
  d.update(target_source_id='fanning2021-paper',target_rationale='Fixed published analytical benchmark from Fanning et al. Table 1 (2021 online / 2022 issue), held invariant for this partial adaptation; not an Argentine statutory target or proof that every resident has adequate provision.')
 indicators.append(d);return d
def obs(id,start,end,value,sid,locator,group,flags=None,missing=None,extra=None):
 source=S[sid] if sid else None
 row={'indicator_id':id,'period_start':start,'period_end':end,'observation_year':int(end[:4]),'value':value,'source_id':sid,'source_locator':locator,'release_date':source['release_date'] if source else None,'retrieved_at':source['retrieved_at'] if source else S['indec-poverty-fragment']['retrieved_at'],'epistemic_type':'retrospective-estimate','status':'missing' if value is None else 'source-supported-observation','comparability_group':group,'break_flags':flags or [],'missing_reason':missing if value is None else None}
 if extra:row.update(extra)
 observations.append(row)
def annual(id,y,value,sid,locator,group,**kw):obs(id,f'{y}-01-01',f'{y}-12-31',value,sid,locator,group,**kw)
def semester(id,y,h,value,sid,locator,group,**kw):obs(id,f'{y}-01-01' if h==1 else f'{y}-07-01',f'{y}-06-30' if h==1 else f'{y}-12-31',value,sid,locator,group,**kw)
# WDI raw indicators; each series retains its own units, latest year and missing values.
configs=[
 ('SP.DYN.LE00.IN','life_expectancy','Life expectancy at birth','social','years','higher',74,'UN population estimates; not healthy life expectancy. Historical revisions retained in this single WDI vintage.'),
 ('SH.DYN.MORT','under5_mortality','Under-five mortality','social','deaths per 1,000 live births','lower',None,'UN Inter-agency Group for Child Mortality Estimation model estimates, not annual census counts.'),
 ('EG.ELC.ACCS.ZS','electricity_access','Access to electricity','social','%','higher',95,'WDI/Tracking SDG7 estimates. Basic access is not affordability, reliability, or clean cooking. The 2024 decline is retained and must not automatically be attributed to policy.'),
 ('IT.NET.USER.ZS','internet_use','Individuals using the Internet','social','%','higher',None,'ITU estimates and surveys; use/access is not quality or affordability.'),
 ('SL.UEM.TOTL.ZS','unemployment','Unemployment, ILO modelled estimate','social','%','lower',None,'ILO-modelled unemployed share of labour force; not total-population joblessness or formal employment. Do not splice with quarterly INDEC EPH unemployment.'),
 ('NY.GDP.PCAP.KD','gdp_per_capita','Real GDP per capita','context','constant 2015 US$','context',None,'National-accounts estimates; GDP is context, not a Doughnut social outcome or a distribution measure.'),
 ('SH.H2O.BASW.ZS','basic_water','At least basic drinking-water services','social','%','higher',None,'WHO/UNICEF JMP WDI series returned Argentina data only through 2016. Do not carry forward or confuse basic with safely managed water.'),
 ('SH.STA.BASS.ZS','basic_sanitation','At least basic sanitation services','social','%','higher',None,'WHO/UNICEF JMP WDI series returned Argentina data only through 2016. Basic is not safely managed sanitation or sewer network connection.'),
 ('AG.LND.FRST.ZS','forest_area','Forest area as share of land','ecological','% of land area','higher',None,'FAO forest-stock estimates; not biodiversity, primary forest integrity, native-forest loss, or share of original biome cover. National annual estimates may include interpolation by producer.'),
 ('EN.ATM.PM25.MC.M3','pm25','PM2.5 mean annual population-weighted exposure','ecological','µg/m³','lower',None,'Modelled national population-weighted exposure; no post-2023 observation in this vintage. A health indicator, not a national allocation of the planetary aerosol boundary.'),
 ('EG.FEC.RNEW.ZS','renewable_energy','Renewables in total final energy consumption','ecological','% of total final energy','higher',None,'WDI series returned data through 2021 only; not renewable electricity share.'),
 ('ER.H2O.FWST.ZS','water_stress','Freshwater withdrawal relative to available resources','ecological','% of available freshwater resources','lower',None,'FAO AQUASTAT national SDG6.4.2 aggregate. Identical source values 2013–2022 do not establish annual unchanged local water stress; masks seasonal/subnational scarcity and is not consumption footprint.')]
vals={}
for code,id,label,dimension,unit,direction,target,notes in configs:
 indicator(id,label,dimension,unit,direction,target=target,notes=notes)
 raw=read('wdi-'+code+'.json'); byyear={int(r['date']):r for r in raw[1]};vals[id]=byyear
 sid='wdi-'+code if code!='ER.H2O.FWST.ZS' else 'wdi-water-stress'
 for y in range(2013,2026):
  row=byyear.get(y,{});v=row.get('value')
  annual(id,y,v,sid,f'JSON records countryiso3code=ARG, indicator.id={code}, date={y}; dataset_lastupdated={raw[0].get("lastupdated")}','wdi-'+code+'-single-vintage',missing='No non-null value returned by archived WDI API for this year.',extra={'source_obs_status':row.get('obs_status'),'decimal_places':row.get('decimal')})
# Fixed-benchmark employment is a transparent complement of modelled unemployment.
indicator('employment','Labour force employed (100 − unemployment)','social','%','higher',target=94,notes='Derived 100 minus ILO-modelled unemployed share; excludes people outside the labour force and does not measure job quality, hours, or informality.')
for y in range(2013,2026):
 r=vals['unemployment'].get(y,{});v=r.get('value');annual('employment',y,None if v is None else 100-v,'wdi-SL.UEM.TOTL.ZS',f'100 minus WDI SL.UEM.TOTL.ZS, date={y}','ilo-modelled-complement',missing='Underlying unemployment estimate unavailable.')
# Internationally reported Argentina inequality is a second-semester urban survey.
pip=read('pip-argentina-all.json');pip_year={int(r['reporting_year']):r for r in pip if r.get('survey_acronym')=='EPHC-S2' and r.get('welfare_type')=='income'}
gini=read('wdi-SI.POV.GINI.json');gini_year={int(r['date']):r['value'] for r in gini[1]}
for id,label,transform,target in [('gini','Gini index, urban second-semester survey',lambda v:v,None),('equality','Income equality (100 − urban Gini)',lambda v:100-v,70)]:
 indicator(id,label,'social','points (0–100)','lower' if id=='gini' else 'higher','semester',GINI_GEO,target=target,notes='WDI reporting year is tied to EPHC-S2 in PIP, not an annual-average distribution. WDI rounded Gini retained; PIP is used to establish coverage/period. 2015 is missing and 2013–2015 INDEC statistics carry official reservations.')
 for y in range(2013,2026):
  for h in [1,2]:
   v=gini_year.get(y) if h==2 else None
   flags=['INDEC_2007_2015_statistics_reservations'] if y<2016 else []
   if y==2016 and h==2:flags.append('resumption_after_2015_gap')
   if y in [2019,2020] and h==2:flags.append('EPH_geographic_exclusion_see_coverage')
   if v is not None and y in pip_year:assert pip_year[y]['survey_coverage']=='urban'
   semester(id,y,h,transform(v) if v is not None else None,'wdi-SI.POV.GINI',f'WDI SI.POV.GINI date={y}, rounded value; PIP survey EPHC-S2 metadata: data source pip-argentina-all','pip-urban-S2-reference-series',flags=flags,missing='No first-semester value in the annual-labelled WDI/PIP EPHC-S2 series.' if h==1 else 'No non-null WDI Gini value for this reference year.',extra={'supporting_source_ids':['pip-argentina-all']})
# INDEC poverty, no national extrapolation.
b=xlrd.open_workbook(RAW/'indec-poverty-2026h1-tables.xls');t=b.sheet_by_name('Cuadro 1')
for id,label,rowidx in [('poverty','People below the national income poverty line, EPH urban sample',6),('indigence','People below the food-basket indigence line, EPH urban sample',10)]:
 indicator(id,label,'social','%','lower','semester',URBAN,notes='Monetary household-basket poverty/indigence; survey estimates, not a multidimensional poverty measure. Comparable historical publication restarts H2 2016; H2 2023 overlaps 21 days of Milei administration. Latest H1 2026 is provisional.')
 values={}
 for col in range(1,t.ncols):
  header=str(t.cell_value(2,col));m=re.search(r'(201\d|202\d)',header)
  if m:values[(int(m.group(1)),1 if header.startswith('1') else 2)]=(t.cell_value(rowidx,col),col)
 for y in range(2013,2027):
  for h in [1,2]:
   if (y,h)>(2026,1):continue
   v,col=values.get((y,h),(None,None));flags=[];group='indec-eph-restarted-2016'
   if y<2016 or (y,h)==(2016,1):group='no-comparable-restarted-series'
   if (y,h)==(2016,2):flags.append('series_restart_after_statistics_emergency')
   if (y,h)==(2019,2):flags.append('excludes_Gran_Resistencia');group='indec-eph-excludes-Gran-Resistencia'
   if (y,h)==(2020,1):flags+=['coverage_restored_Gran_Resistencia','COVID_remote_survey_collection'];
   if (y,h)==(2020,2):flags+=['excludes_Ushuaia_Rio_Grande','COVID_remote_survey_collection'];group='indec-eph-excludes-Ushuaia-Rio-Grande'
   if (y,h)==(2021,1):flags.append('coverage_restored_Ushuaia_Rio_Grande')
   extra={'provisional':(y,h)==(2026,1)}
   cis={'poverty':{(2024,1):[51.4,54.5],(2024,2):[36.3,39.6],(2025,1):[30.1,33.1],(2025,2):[26.8,29.7],(2026,1):[30.8,33.7]},'indigence':{(2024,1):[16.8,19.5],(2024,2):[7.4,9.0],(2025,1):[6.1,7.7],(2025,2):[5.5,7.0],(2026,1):[6.6,8.4]}}
   if (y,h) in cis[id]:extra.update(confidence_interval=cis[id][(y,h)],confidence_level=0.90,confidence_source_id='indec-poverty-2026h1',confidence_locator='Printed page 5, Table 1')
   if (y,h)==(2026,1):extra['statistical_comparisons']=[{'reference_period_start':'2025-01-01','reference_period_end':'2025-06-30','conclusion':'no-significant-change','producer_statement':'INDEC reports no significant change from the same semester of the preceding year.','source_id':'indec-poverty-2026h1','source_locator':'Printed page 4, Evolution'}]
   semester(id,y,h,v,'indec-poverty-2026h1-tables' if v is not None else 'indec-poverty-fragment',f'Workbook Cuadro 1, row {rowidx+1}, column {col+1}; source footnotes rows13 and15' if col else 'Official topic fragment, historical publication warning',group,flags=flags,missing='Comparable restarted INDEC semester series unavailable; publication stopped in H2 2013 and resumed with Q2 2016, which is not a full semester.',extra=extra)
# National CPI; percentage changes are different from the price-level index.
b=xlrd.open_workbook(RAW/'indec-cpi-historical.xls');cpi_tables={}
for id,label,sheet in [('cpi_monthly','National CPI, month-on-month change','Variación mensual IPC Nacional'),('cpi_yoy','National CPI, year-on-year change','Var. interanual IPC Nacional')]:
 indicator(id,label,'context','%','context','monthly',notes='National CPI with December2016=100 base. Earlier IPC-GBA/IPCNu series are not spliced. A declining inflation rate does not mean prices fall. December2023 combines two administrations.')
 s=b.sheet_by_name(sheet);tab={}
 for col in range(1,s.ncols):
  try:d=xlrd.xldate_as_datetime(s.cell_value(5,col),b.datemode)
  except (ValueError,TypeError):continue
  tab[(d.year,d.month)]=(s.cell_value(9,col),col)
 cpi_tables[id]=tab
 for y in range(2013,2027):
  for m in range(1,13):
   if (y,m)>(2026,9):continue
   v,col=tab.get((y,m),(None,None))
   obs(id,f'{y}-{m:02d}-01',f'{y}-{m:02d}-{calendar.monthrange(y,m)[1]}',v,'indec-cpi-historical',f'Sheet {sheet}, row10, column {col+1}' if col else 'National series not provided for this period','national-cpi-2016base',flags=['national_series_start'] if (y,m)==min(tab) else [],missing='No comparable national CPI observation in archived workbook; no splice with earlier regional indexes.')
indicator('cpi_annual','National CPI, December-to-December inflation','context','%','context',notes='December year-on-year CPI, not annual-average inflation. 2026 has no completed annual December period as of retrieval.')
for y in range(2013,2026):
 v,col=cpi_tables['cpi_yoy'].get((y,12),(None,None));annual('cpi_annual',y,v,'indec-cpi-historical',f'Sheet Var. interanual IPC Nacional, row10, December{y} column {col+1}' if col else 'December national year-on-year not available','national-cpi-december',missing='National December-to-December series unavailable before2017.')
# Global Carbon Budget territorial and consumption accounts; no land-use change or other gases.
b=openpyxl.load_workbook(RAW/'gcb-national-v2025-site.xlsx',read_only=True,data_only=True)
pop={int(r['date']):r['value'] for r in read('wdi-SP.POP.TOTL.json')[1]}
for sheet,prefix,label in [('Territorial Emissions','co2_territorial','Territorial fossil and cement CO₂'),('Consumption Emissions','co2_consumption','Consumption-based fossil and cement CO₂')]:
 s=b[sheet];table={}
 for i,row in enumerate(s.iter_rows(max_row=200,max_col=9,values_only=True),1):
  if isinstance(row[0],(int,float)) and 2013<=row[0]<=2025:table[int(row[0])]=(row[8],i)
 for percap in [False,True]:
  id=prefix+('_per_capita' if percap else '')
  indicator(id,label+(' per person' if percap else ''),'ecological','t CO₂ per person per year' if percap else 'Mt CO₂ per year','lower',notes='GCB2025 preliminary publisher-site vintage; primary workbook MtC multiplied by exact producer factor3.664.'+(' Then divided by same-vintage WDI population; not a publisher-native per-capita series.' if percap else '')+' Excludes land-use-change CO₂ and non-CO₂ greenhouse gases. Territorial and consumption accounting are distinct; consumption2024+ not provided. No national planetary quota assigned.')
  for y in range(2013,2026):
   rawv,row=table.get(y,(None,None));v=None if rawv is None else rawv*3.664
   if percap and v is not None:v=v*1e6/pop[y] if pop.get(y) else None
   annual(id,y,v,'gcb-national-v2025-site',f'Sheet {sheet}, Argentina column I, row{row}; MtC ×3.664'+(f' ×1e6 / WDI SP.POP.TOTL date{y}' if percap else '') if row else f'No Argentina value for year{y} in sheet {sheet}','gcb-2025-publisher-preliminary',missing='No national country-year value in archived GCB sheet; global2025 projection is not an Argentina observation.',extra={'underlying_value_MtC':rawv,'supporting_source_ids':['wdi-SP.POP.TOTL'] if percap else []})
# UNEP accounts: after2019 source contains projected inputs, so retain separately as reference.
rows=list(csv.DictReader((ROOT/S['unep-material-argentina-export']['path']).open()))
modeled=[]
for code,id,label in [('MF/cap','material_footprint','Material footprint per person'),('DMC/cap','domestic_material_consumption','Domestic material consumption per person')]:
 row=next(r for r in rows if r['Flow code']==code)
 indicator(id,label,'ecological','tonnes per person per year','lower',notes='UNEP IRP Global Material Flows Database; estimated accounts. MF allocates global upstream extraction to final demand; DMC is domestic extraction+physical imports−exports. Linked2024 technical annex p6 says projections enter from2020 and last year suitable for correlation analysis is2019; 2020–2024 values retained only in modeled-reference.json, never promoted to measured history.')
 for y in range(2013,2026):
  v=float(row[str(y)]) if row.get(str(y)) else None
  if y>=2020 and v is not None:modeled.append({'indicator_id':id,'year':y,'value':v,'epistemic_type':'projection-contaminated accounting estimate','source_id':'unep-material-argentina-export','source_locator':f'CSV flow code={code}, column={y}','method_source_id':'unep-material-methods','method_locator':'Technical Annex2024 printedp6 andpp34–35','use_restriction':'Reference only; do not classify as measured post-policy outcome or use for GDP/policy correlations.'})
  annual(id,y,v if y<=2019 else None,'unep-material-argentina-export',f'CSV country=Argentina, flow code={code}, column={y}','unep-irp-preprojection-window',flags=['source_projection_components_begin'] if y==2020 else [],missing='Source contains projected inputs from2020; excluded from empirical history. See separately labelled modeled reference.' if 2020<=y<=2024 else 'No2025 value in source export.',extra={'supporting_source_ids':['unep-material-methods']})
write('modeled-reference.json',{'scope':'Source model outputs, not empirical policy evaluation','records':modeled})
# Historical original publication is its own normalized series, never spliced into modern measures.
b=openpyxl.load_workbook(RAW/'fanning2021-data.xlsx',read_only=True,data_only=True);historical=[]
for name in ['Biophysical_Historical','Social_Historical']:
 s=b[name];headers=next(s.iter_rows(min_row=1,max_row=1,values_only=True))
 for i,row in enumerate(s.iter_rows(min_row=2,values_only=True),2):
  if row[1]!='ARG':continue
  for col in range(3,len(headers)):
   historical.append({'country':'Argentina','iso3':'ARG','year':row[2],'indicator':headers[col],'value':row[col],'unit':'ratio to publication-specific boundary or threshold','source_id':'fanning2021-data','source_locator':f'{name}, row{i}, column{col+1}','epistemic_type':'historical model/accounting estimate; some original indicators include imputation or projection even before2015','do_not_splice':True})
write('published-historical-reference.json',{'citation':'Fanning et al., DOI10.1038/s41893-021-00799-z','observation_scope':'1992–2015 historical sheets only. BAU sheets2016–2050 deliberately not imported. Nitrogen2011–2015 includes original projected inputs; HANPP includes original carried values.','records':historical})
# Events are dated evidence; categories do not encode causal attribution.
events=[
 {'id':'macri-election','date':'2015-11-22','category':'election','label':'Presidential runoff election2015','source_id':'event-election2015-consular','source_locator':'Argentina foreign ministry historical country brief states Macri won runoff held22November2015; historical election date, not present-office claim'},
 {'id':'macri-inauguration','date':'2015-12-10','category':'inauguration','label':'Mauricio Macri takes office','source_id':'event-inaugurations','source_locator':'Official roster of presidents and ministers'},
 {'id':'imf2018','date':'2018-06-20','category':'policy','label':'IMF Stand-By Arrangement approved','source_id':'event-imf-bcra','source_locator':'Official agreement history, 2010–2019 table'},
 {'id':'fernandez-inauguration','date':'2019-12-10','category':'inauguration','label':'Alberto Fernández takes office','source_id':'event-inaugurations','source_locator':'Official roster of presidents and ministers'},
 {'id':'covid-isolation','date':'2020-03-20','category':'context','label':'COVID-19 mandatory isolation begins (Decree297/2020)','source_id':'event-covid-arca','source_locator':'Articles1 and12, publication20March2020'},
 {'id':'drought2023','date':'2023-02-01','date_end':'2023-02-28','category':'context','label':'Severe drought documented in February2023','source_id':'event-drought','source_locator':'SMN February2023 drought bulletin record; published2023-03-01','date_precision':'month; report period, not shock onset'},
 {'id':'milei-election','date':'2023-11-19','category':'election','label':'Presidential runoff election2023','source_id':'event-election2023-act','source_locator':'Official Neuquen election certification, first-page record states election held19November2023; no national vote totals inferred from district result'},
 {'id':'milei-inauguration','date':'2023-12-10','category':'inauguration','label':'Javier Milei takes office','source_id':'event-milei-inauguration','source_locator':'Chamber of Deputies inauguration record10December2023'},
 {'id':'fx-reset2023','date':'2023-12-12','category':'policy','label':'New monetary/exchange framework; official exchange rate800pesos/USD announced','source_id':'event-bcra2023','source_locator':'BCRA announcement12December2023; policy adoption, not estimated effect'},
 {'id':'dnu70','date':'2023-12-21','category':'policy','label':'Decree70/2023 published: economic emergency and regulatory changes','source_id':'event-dnu70-arca','source_locator':'Emission20December, official publication21December2023; subsequent judicial/legal changes not assumed away'},
 {'id':'ley-bases','date':'2024-07-08','category':'policy','label':'Law27,742 (Ley Bases) published','source_id':'event-bases-normativa','source_locator':'Official text; administration/emergency, investment incentives and labour provisions; publication date distinct from passage'},
]
events.extend([
 {'id':'imf2025','date':'2025-04-11','category':'policy','label':'New IMF Extended Fund Facility agreement','source_id':'event-imf-bcra','source_locator':'Official agreement history table,2025-04-11 Extended Fund Facility'},
 {'id':'fx-bands2025','date':'2025-04-11','category':'policy','label':'BCRA announces exchange liberalization and floating bands','source_id':'event-bcra2025-bands','source_locator':'Phase3 announcement dated11April2025; adoption date, not outcome effect'},
 {'id':'monetary2026-announcement','date':'2025-12-15','category':'policy','label':'BCRA announces monetary programme and band-indexation rule for2026','source_id':'event-bcra2026-plan','source_locator':'Official press note15December2025, monetary programme2026; announcement separate from effective date'},
 {'id':'band-indexation2026','date':'2026-01-01','category':'policy','label':'Inflation-linked exchange-band adjustment rule takes effect','source_id':'event-bcra-bands-regime','source_locator':'Regime description: from1January2026 band drift uses latest monthly INDEC inflation(T−2); future band table not imported as observations'},
])
# Only include events backed by a successful archive; unresolved lookups remain documented gaps.
unarchived=[e for e in events if e['source_id'] not in S];events=[e for e in events if e['source_id'] in S]
write('event-gaps.json',unarchived)
for e in events:e['causal_status']='chronology only; not an estimated treatment effect'
write('indicators.json',indicators);write('observations.json',observations);write('events.json',events)
bundle={'schema_version':'1.0.0','as_of':'2026-10-29','geography':COUNTRY,'scope':{'title':'Argentina,2013 to latest released observation: partial social Doughnut and ecological evidence','baseline':'2013–2023; data gaps retained','turning_point':'2023-12-10','turning_point_status':'Provisional working interpretation of the rightward shift: Milei inauguration. Macri2015 is independently marked.','post_window':'First fully post-inauguration periods begin2024; latest observations vary by indicator. H2 2023 overlaps administrations.','doughnut_scope':'Four fixed published social benchmarks only: life expectancy74, electricity95, employment94, equality70. Equality covers urban second-semester surveys. Ecological series are unscored; no fabricated national planetary ceilings.','causal_status':'Descriptive, not causal. No empirical scenario or policy-effect estimate is supplied.','target_version':'Fanning et al.2021 online/2022 issue Table1; fixed across modern comparison years.','missing_data_policy':'No extrapolation, no missing-to-zero, no annual/semester substitution, no post-2015 BAU treated as observation.','featured_social':['life_expectancy','electricity_access','employment','equality'],'featured_ecological':['co2_territorial_per_capita','co2_consumption_per_capita','forest_area','pm25','material_footprint','water_stress','renewable_energy']},'indicators':indicators,'observations':observations,'events':events,'sources':sources}
write('portrait-series.json',bundle)
# Machine-readable endpoint audit table, preserving each series' true latest period.
endpoints=[]
for i in indicators:
 rows=sorted([r for r in observations if r['indicator_id']==i['id'] and r['value'] is not None],key=lambda r:r['period_start'])
 if rows:endpoints.append({'indicator_id':i['id'],'unit':i['unit'],'first':rows[0],'last_pre_2024':next((r for r in reversed(rows) if r['period_end']<'2024-01-01'),None),'latest':rows[-1]})
write('endpoints.json',endpoints)
# Verify source bytes and source/observation references immediately.
for s in sources:
 path=ROOT/s['path'];assert path.is_file(),s
 assert hashlib.sha256(path.read_bytes()).hexdigest()==s['sha256'],s['id']
assert all(r['source_id'] in S for r in observations if r['value'] is not None)
assert len({(r['indicator_id'],r['period_start']) for r in observations})==len(observations)
print(json.dumps({'indicators':len(indicators),'observations':len(observations),'sources':len(sources),'events':len(events),'explicit_nulls':sum(r['value'] is None for r in observations),'unarchived_events':len(unarchived)}))
