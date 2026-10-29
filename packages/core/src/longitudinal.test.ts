import { describe, expect, it } from 'vitest';
import { longitudinalChange, longitudinalDatasetSchema, longitudinalSeries, socialThresholdAtPeriod } from './longitudinal.js';

const geography={id:'ARG-EPH31',name:'Argentina urban survey',level:'survey-coverage',coverage:'31 EPH urban agglomerations; not national'};
const fixture=()=>({schema_version:'1.0.0',as_of:'2026-10-29',geography,scope:'Published statistical estimates only; no causal policy interpretation.',
  indicators:[{id:'poverty',label:'Urban poverty',dimension:'social',unit:'%',direction:'lower',frequency:'semester',geography,epistemic_type:'estimate',target:null,target_rationale:null,comparability_notes:'EPH survey coverage'}],
  sources:[{id:'eph',title:'Official report',publisher:'INDEC',url:'https://example.gov/report.pdf',path:'raw/report.pdf',sha256:'a'.repeat(64),retrieved_at:'2026-10-29T01:00:00Z',release_date:'2026-09-20'}],
  observations:[
    {indicator_id:'poverty',epistemic_type:'retrospective-estimate',status:'source-supported-observation',period_start:'2025-01-01',period_end:'2025-06-30',observation_year:2025,value:30,source_id:'eph',source_locator:'Table1',release_date:'2025-09-20',retrieved_at:'2026-10-29T01:00:00Z',comparability_group:'eph-current',break_flags:[],missing_reason:null},
    {indicator_id:'poverty',epistemic_type:'retrospective-estimate',status:'source-supported-observation',period_start:'2025-07-01',period_end:'2025-12-31',observation_year:2025,value:28,source_id:'eph',source_locator:'Table1',release_date:'2026-03-20',retrieved_at:'2026-10-29T01:00:00Z',comparability_group:'eph-current',break_flags:[],missing_reason:null},
    {indicator_id:'poverty',epistemic_type:'retrospective-estimate',status:'source-supported-observation',period_start:'2026-01-01',period_end:'2026-06-30',observation_year:2026,value:32,source_id:'eph',source_locator:'Table1',release_date:'2026-09-20',retrieved_at:'2026-10-29T01:00:00Z',comparability_group:'eph-current',break_flags:[],missing_reason:null},
  ],events:[]});

describe('longitudinal statistical contract',()=>{
  it('keeps release dates separate, compares native values, and labels change descriptive only',()=>{
    const dataset=longitudinalDatasetSchema.parse(fixture());
    expect(longitudinalSeries(dataset,'poverty').segments.map(s=>s.length)).toEqual([3]);
    expect(longitudinalChange(dataset,'poverty','2025-07-01','2026-01-01')).toMatchObject({comparable:true,delta:4,unit:'percentage points',relative_pct:4/28*100,interpretation:'descriptive-change-only'});
    expect(dataset.indicators[0]!.geography.coverage).toContain('not national');
  });
  it('breaks lines at gaps and refuses endpoint deltas only over known method/coverage changes',()=>{
    for(const mode of ['null','break','coverage','absent']){
      const raw=fixture();
      if(mode==='null'){raw.observations[1]!.value=null as unknown as number;raw.observations[1]!.missing_reason='Unavailable' as unknown as null;raw.observations[1]!.status='missing';}
      if(mode==='break')raw.observations[1]!.break_flags=['New method'] as never[];
      if(mode==='coverage')raw.observations[1]!.comparability_group='different-coverage';
      if(mode==='absent')raw.observations.splice(1,1);
      const dataset=longitudinalDatasetSchema.parse(raw);
      expect(longitudinalSeries(dataset,'poverty').segments.length).toBeGreaterThan(1);
      const change=longitudinalChange(dataset,'poverty','2025-01-01','2026-01-01');
      expect(change.comparable).toBe(mode==='null'||mode==='absent');
      if(change.comparable)expect(change.missing_between).toBe(1);
    }
  });
  it('rejects future observations, impossible dates, period/release confusion, unarchived values and ungrounded targets',()=>{
    for(const mutate of [
      (d:ReturnType<typeof fixture>)=>{d.observations[0]!.period_end='2027-06-30';},
      (d:ReturnType<typeof fixture>)=>{d.observations[0]!.period_end='2025-02-30';},
      (d:ReturnType<typeof fixture>)=>{d.observations[0]!.observation_year=2026;},
      (d:ReturnType<typeof fixture>)=>{d.observations[0]!.release_date='2024-01-01';},
      (d:ReturnType<typeof fixture>)=>{d.observations[0]!.source_id='missing';},
      (d:ReturnType<typeof fixture>)=>{d.sources[0]!.path='../secret';},
      (d:ReturnType<typeof fixture>)=>{d.indicators[0]!.target=0 as unknown as null;},
      (d:ReturnType<typeof fixture>)=>{d.observations.push({...d.observations[0]!});},
    ]){const raw=fixture();mutate(raw);expect(longitudinalDatasetSchema.safeParse(raw).success).toBe(false);}
  });
  it('scores only cited fixed social benchmarks and never fills an absent period',()=>{
    const raw=fixture();raw.indicators[0]!.direction='higher';raw.indicators[0]!.target=40 as unknown as null;
    raw.indicators[0]!.target_rationale='Published analytical benchmark, not national law.' as unknown as null;
    Object.assign(raw.indicators[0]!,{target_source_id:'eph'});
    const dataset=longitudinalDatasetSchema.parse(raw);
    expect(socialThresholdAtPeriod(dataset,'poverty','2025-01-01')).toMatchObject({status:'assessed',value:30,target:40,shortfall_pct:25,display_fraction:0.75});
    expect(socialThresholdAtPeriod(dataset,'poverty','2024-01-01').status).toBe('unknown');
    raw.observations[0]!.value=50;const over=socialThresholdAtPeriod(longitudinalDatasetSchema.parse(raw),'poverty','2025-01-01');
    expect(over).toMatchObject({status:'assessed',attainment_ratio:1.25,shortfall_pct:0,display_fraction:1});
    expect(socialThresholdAtPeriod(longitudinalDatasetSchema.parse(fixture()),'poverty','2025-01-01').status).toBe('unknown');
  });

  it('validates reported uncertainty without inventing intervals for other rows',()=>{
    const raw=fixture();Object.assign(raw.observations[0]!,{uncertainty:{lower:28,upper:32,method:'Published survey interval',confidence_level:0.9}});
    const parsed=longitudinalDatasetSchema.parse(raw);expect(parsed.observations[0]!.uncertainty?.confidence_level).toBe(0.9);
    expect(parsed.observations[1]!.uncertainty).toBeUndefined();
    Object.assign(raw.observations[0]!,{uncertainty:{lower:31,upper:32,method:'Wrong interval'}});
    expect(longitudinalDatasetSchema.safeParse(raw).success).toBe(false);
  });

  it('keeps explicit projections out of observed segments and historical threshold fills',()=>{
    const raw=fixture();raw.observations[2]!.epistemic_type='projection';raw.observations[2]!.status='source-supported-projection';
    const dataset=longitudinalDatasetSchema.parse(raw);
    expect(longitudinalSeries(dataset,'poverty').observations).toHaveLength(3);
    expect(longitudinalSeries(dataset,'poverty').segments.flat()).toHaveLength(2);
    expect(longitudinalChange(dataset,'poverty','2025-01-01','2026-01-01').comparable).toBe(false);
    raw.observations[2]!.status='source-supported-observation';
    expect(longitudinalDatasetSchema.safeParse(raw).success).toBe(false);
  });

  it('binds reported confidence intervals and significance statements to their source and reference period',()=>{
    const raw=fixture();
    Object.assign(raw.observations[2]!,{provisional:true,confidence_interval:[30,34],confidence_level:0.9,confidence_source_id:'eph',confidence_locator:'Table1',statistical_comparisons:[{reference_period_start:'2025-01-01',reference_period_end:'2025-06-30',conclusion:'no-significant-change',producer_statement:'The producer reports no significant annual change.',source_id:'eph',source_locator:'Evolution'}]});
    const dataset=longitudinalDatasetSchema.parse(raw);
    expect(dataset.observations[2]!.statistical_comparisons?.[0]?.reference_period_start).toBe('2025-01-01');
    for(const patch of [{confidence_interval:[33,34]},{confidence_source_id:'missing'},{confidence_level:1},{statistical_comparisons:[{...dataset.observations[2]!.statistical_comparisons![0]!,reference_period_start:'2024-01-01'}]}]){
      const invalid=structuredClone(raw);Object.assign(invalid.observations[2]!,patch);
      expect(longitudinalDatasetSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('compares same-season semester endpoints despite an unreported intervening semester',()=>{
    const raw=fixture();raw.observations[0] = {...raw.observations[0]!,period_start:'2024-07-01',period_end:'2024-12-31',observation_year:2024,value:25};
    raw.observations[1] = {...raw.observations[1]!,period_start:'2025-01-01',period_end:'2025-06-30',value:null as unknown as number,status:'missing',missing_reason:'H1 not reported' as unknown as null};
    raw.observations[2] = {...raw.observations[2]!,period_start:'2025-07-01',period_end:'2025-12-31',observation_year:2025,value:30};
    const dataset=longitudinalDatasetSchema.parse(raw);
    const change=longitudinalChange(dataset,'poverty','2024-07-01','2025-07-01');
    expect(change).toMatchObject({comparable:true,delta:5,missing_between:1});
    if(change.comparable)expect(change.caveats.join(' ')).toContain('no value was interpolated');
    expect(longitudinalSeries(dataset,'poverty').segments.map(s=>s.length)).toEqual([1,1]);
  });

  it('keeps a zero baseline valid without dividing by zero and never annualizes semester observations',()=>{
    const raw=fixture();raw.observations[0]!.value=0;
    const result=longitudinalChange(longitudinalDatasetSchema.parse(raw),'poverty','2025-01-01','2025-07-01');
    expect(result).toMatchObject({comparable:true,delta:28,relative_pct:null});
    expect(longitudinalSeries(longitudinalDatasetSchema.parse(raw),'poverty').observations).toHaveLength(3);
  });
});
