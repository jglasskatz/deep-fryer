"""Bind reviewer-suggested corrections and record transparent corrective self-checks."""
from pathlib import Path
import copy, gzip, hashlib, json
from datetime import datetime, timezone

B=Path(__file__).resolve().parent.parent
H=lambda b:hashlib.sha256(b).hexdigest()
C=lambda x:json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
original_bytes=(B/'findings/amendments.json').read_bytes()
assert H(original_bytes)=='8a4f14c2b14a2ac501f3eb884819bd74c134abf3b4283d6bc7936001ab69866a'
assert H((B/'findings/supplemental-housing.json').read_bytes())=='0b7508b08a4ea7af36a32850f13aec3e578f2897a5fc6e4b41960fbe7ce21d30'
original=json.loads(original_bytes)
byid={a['id']:a for a in original['amendments']}
stems={'nyc:biodiversity-loss:0':'reviewer-conservation-corrected','santa-cruz-county:networks:0':'reviewer-county-broadband-corrected','bronx:networks:0':'reviewer-fixed-broadband-corrected','staten-island:networks:0':'reviewer-fixed-broadband-corrected'}
reasons={
    'nyc:chemical-pollution:1':'Remove the ambiguous Bronx sentence from the NYC fiscal-year observation. The supported NYC result remains FY 2005–2025 reduction 12.55%, unscored.',
    'nyc:biodiversity-loss:0':'Correct the derived exhibit arithmetic to 19.52183345%; preserve the rounded 19.5% land-and-water observation and null land-only score.',
    'santa-cruz-county:networks:0':'Replace the mismatched exhibit with the exact official GCT2801 county 94.9% ±1.1 percentage point row and explicit 2024 one-year period.',
    'bronx:networks:0':'Retain the publisher-supported 2023 fixed-broadband estimate as an unscored related observation; do not apply the generic any-broadband contract.',
    'staten-island:networks:0':'Retain the publisher-supported 2023 fixed-broadband estimate as an unscored related observation; do not apply the generic any-broadband contract.',
}
corrections=[]
for id in reasons:
    a=copy.deepcopy(byid[id])
    a['id']=id+':reviewer-correction-v1'
    a['supersedes_amendment_id']=id
    a['supersedes_amendment_file']='findings/amendments.json'
    a['supersedes_amendment_file_sha256']=H(original_bytes)
    a['supersedes_amendment_canonical_sha256']=H(C(byid[id]))
    a['author_role']='reviewer-suggested correction; author cannot independently approve this new payload'
    a['reason']=reasons[id]
    after=a['after']
    if id=='nyc:chemical-pollution:1':
        after['notes']='FY 2005 DSNY refuse collected: 3,348,817.81 tons; FY 2025: 2,928,470.67 tons. Each year includes 708 unique district-month records across all 12 fiscal months, July–June. Reduction = (3,348,817.81 − 2,928,470.67) / 3,348,817.81 × 100 = 12.5521053652%, rounded to 12.55%. Refuse collected from residences and institutions is a disposal proxy; it does not establish final landfill destination or include all commercial/private collection. The configured landfill-bound measure remains unresolved, so no target or score is asserted.'
    if id in stems:
        stem=stems[id]
        meta=json.loads((B/'activity'/f'{stem}.json').read_text())
        assert meta['success'] is True
        after['evidence_path']=meta['snapshot_path']
        after['evidence']={'snapshot_path':meta['snapshot_path'],'captured_at':meta['captured_at']}
        for support in a['source_support']:
            if support.get('snapshot_path'):
                support['snapshot_path']=meta['snapshot_path']
                support['snapshot_sha256']=H((B/meta['snapshot_path']).read_bytes())
                support['snapshot_captured_at']=meta['captured_at']
        a['derived_exhibit']={'role':'reviewer-generated extract; not a primary publisher source','input_html_path':f'calculations/{stem}.html','input_html_sha256':H((B/'calculations'/f'{stem}.html').read_bytes()),'rendered_html_path':meta['raw_path'],'rendered_html_sha256':H((B/meta['raw_path']).read_bytes()),'snapshot_path':meta['snapshot_path'],'snapshot_sha256':H((B/meta['snapshot_path']).read_bytes()),'captured_at':meta['captured_at']}
    if id in ['bronx:networks:0','staten-island:networks:0']:
        after.update(target=None,level_pct=None,scoring=None,status='source-supported-observation',source_url='https://www.osc.ny.gov/files/reports/pdf/report-20-2025.pdf')
        after['notes']='NYS Office of the State Comptroller Report 20-2025, Figure 4, identifies 2023 fixed broadband: Bronx 63.3%; Staten Island 76.5%. The report generally defines broadband as fixed cable, fiber to the premises or DSL, separately from cellular-only service. These are related fixed-broadband observations. No target, score or wedge is asserted against the generic broadband-subscription indicator. Applying a fixed-only score would require an explicit reviewed indicator contract and target. The 2024 any-broadband values measure a different construct and year and do not establish change in this fixed-only series.'
        after['source']='NYS Office of the State Comptroller, Broadband Availability, Access and Affordability in New York City, Report 20-2025 (December 2024), Figure 4; ACS 2023 one-year files, OSC analysis'
        after['pdf_path']='../../site/evidence/shared/e89455fc53fef9ac48a438f1.pdf'
        after['evidence']['pdf_path']=after['pdf_path']
        a['source_support'][0]['url']=after['source_url']
    a['field_diff']={k:{'before':a['before'].get(k),'after':v} for k,v in after.items() if a['before'].get(k)!=v}
    a['review_required']=True
    corrections.append(a)

doc={'schema_version':1,'baseline_snapshot_sha256':original['baseline_snapshot_sha256'],'research_model':'gpt-6.1-sol','reasoning_effort':'high','author_role':'reviewer-suggested corrective batch; separate independent review required','approved':False,'human_approval':False,'amendments':corrections}
path=B/'findings/reviewer-suggested-corrections.json'
path.write_text(json.dumps(doc,indent=2,ensure_ascii=False)+'\n')
manifest={}
checks=[]
def check(name,actual,expected):
    checks.append({'check':name,'pass':actual==expected,'actual':actual,'expected':expected})
for a in corrections:
    check(a['id']+' before unchanged',a['before'],byid[a['supersedes_amendment_id']]['before'])
    check(a['id']+' unscored',[(a['after'].get(k)) for k in ['target','scoring','level_pct']],[None,None,None])
    for support in a['source_support']:
        p=support['raw_path']; data=(B/p).read_bytes()
        primary=gzip.decompress(data) if support.get('raw_encoding','').startswith('gzip') else data
        check(a['id']+' raw '+p,H(primary),support['raw_sha256'])
        manifest[p]={'sha256':H(data),'bytes':len(data),'role':'publisher source archive','original_sha256':H(primary)}
        if support.get('snapshot_path'):
            p=support['snapshot_path'];data=(B/p).read_bytes()
            check(a['id']+' snapshot '+p,H(data),support['snapshot_sha256'])
            manifest[p]={'sha256':H(data),'bytes':len(data),'role':'derived exhibit screenshot'}
    for field in ['input_html','rendered_html']:
        if a.get('derived_exhibit'):
            p=a['derived_exhibit'][field+'_path'];data=(B/p).read_bytes()
            check(a['id']+' '+field,H(data),a['derived_exhibit'][field+'_sha256'])
            manifest[p]={'sha256':H(data),'bytes':len(data),'role':'derived exhibit HTML'}
check('Conservation corrected exact arithmetic','19.52183345%' in (B/'raw/reviewer-conservation-corrected.html').read_text(),True)
check('County correct GCT row in exhibit',all(s in (B/'raw/reviewer-county-broadband-corrected.html').read_text() for s in ['94.9','+/-1.1','GCT2801','0500000US06087']),True)
check('NYC note no Bronx misattribution','Bronx' not in corrections[0]['after']['notes'],True)
check('Fixed exhibit contains both source values',all(s in (B/'raw/reviewer-fixed-broadband-corrected.html').read_text() for s in ['63.3%','76.5%','No target or score']),True)
check('Original main batch unchanged',H((B/'findings/amendments.json').read_bytes()),'8a4f14c2b14a2ac501f3eb884819bd74c134abf3b4283d6bc7936001ab69866a')
check('Original housing supplement unchanged',H((B/'findings/supplemental-housing.json').read_bytes()),'0b7508b08a4ea7af36a32850f13aec3e578f2897a5fc6e4b41960fbe7ce21d30')
manifest_path=B/'reviews/reviewer-corrections-evidence-manifest.json'
manifest_path.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
selfcheck={'schema_version':1,'reviewer':'gpt-6.1-sol','reasoning_effort':'high','role':'corrective self-check by correction author; NOT independent review','approved':False,'human_approval':False,'requires_separate_independent_review':True,'amendment_file':'findings/reviewer-suggested-corrections.json','amendment_file_sha256':H(path.read_bytes()),'evidence_manifest_sha256':H(manifest_path.read_bytes()),'summary':{'checks':len(checks),'passed':sum(c['pass'] for c in checks),'failed':sum(not c['pass'] for c in checks),'new_exhibits_visually_inspected':3},'amendments':[{'id':a['id'],'supersedes_amendment_id':a['supersedes_amendment_id'],'amendment_canonical_sha256':H(C(a)),'after_canonical_sha256':H(C(a['after'])),'proposed_disposition':'ready for separate independent review','reason':a['reason']} for a in corrections],'checks':checks}
(B/'reviews/reviewer-corrections-self-check.json').write_text(json.dumps(selfcheck,indent=2,ensure_ascii=False)+'\n')
activity={'schema_version':1,'role':'corrective author/self-check activity, separate from original independent review','actual_tokens':None,'actual_billed_usd':None,'completed_at':datetime.now(timezone.utc).isoformat(),'counts':{'corrected_amendments_authored':5,'new_local_HTML_extracts':3,'sandboxed_browser_launch_failures':3,'successful_installed_browser_render_jobs':3,'new_exhibits_visually_inspected':3,'new_primary_downloads':0,'checks':len(checks),'database_writes':0,'github_operations':0},'notes':'Installed Chromium required an allowed sandbox escalation after launch failure. No browser installation or publisher-source changes. Same-agent self-check is not independent approval.'}
(B/'reviews/reviewer-corrections-activity.json').write_text(json.dumps(activity,indent=2)+'\n')
print(json.dumps({'batch_sha256':H(path.read_bytes()),'manifest_sha256':H(manifest_path.read_bytes()),'self_check_sha256':H((B/'reviews/reviewer-corrections-self-check.json').read_bytes()),'summary':selfcheck['summary']},indent=2))
assert all(c['pass'] for c in checks)
