import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { longitudinalDatasetSchema, longitudinalChange, socialThresholdAtPeriod } from '../packages/core/src/longitudinal.ts';

const root=path.resolve('research/argentina-2026-10-29');
const json=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const raw=await json('data/portrait-series.json');
const data=longitudinalDatasetSchema.parse(raw);
const observation=(id,start)=>data.observations.find(row=>row.indicator_id===id&&row.period_start===start);

test('every Argentina source resolves inside its dated archive with unchanged bytes',async()=>{
  const base=await realpath(root);
  for(const source of data.sources){
    const file=await realpath(path.join(root,source.path));assert.ok(file.startsWith(base+path.sep));
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),source.sha256,source.id);
  }
});

test('the country portrait preserves empirical gaps, source projections and period-specific benchmarks',async()=>{
  for(const row of data.observations){
    assert.notEqual(row.epistemic_type,'projection');
    if(['material_footprint','domestic_material_consumption'].includes(row.indicator_id)&&row.observation_year>=2020)assert.equal(row.value,null);
    if(row.indicator_id==='poverty'&&row.observation_year<=2015)assert.equal(row.value,null);
  }
  const modeled=await json('data/modeled-reference.json');assert.equal(modeled.records.length,10);
  assert.ok(modeled.records.every(row=>row.year>=2020&&row.year<=2024&&row.method_source_id==='unep-material-methods'));
  const historical=await json('data/published-historical-reference.json');assert.ok(historical.records.every(row=>row.year<=2015));
  assert.equal(socialThresholdAtPeriod(data,'equality','2023-01-01').status,'unknown');
  assert.equal(socialThresholdAtPeriod(data,'equality','2023-07-01').status,'assessed');
  for(const id of raw.scope.featured_social)assert.equal(socialThresholdAtPeriod(data,id,'2026-01-01').status,'unknown');
  assert.equal(longitudinalChange(data,'equality','2013-07-01','2023-07-01').comparable,false);
});

test('reviewed poverty arithmetic and producer uncertainty remain tied to the correct periods',()=>{
  const latest=observation('poverty','2026-01-01');assert.equal(latest.value,32.3);assert.equal(latest.provisional,true);
  assert.deepEqual(latest.confidence_interval,[30.8,33.7]);assert.equal(latest.confidence_level,.9);
  assert.equal(latest.statistical_comparisons[0].reference_period_start,'2025-01-01');
  assert.equal(latest.statistical_comparisons[0].conclusion,'no-significant-change');
  for(const [from,expected] of [['2023-07-01',-9.4],['2025-07-01',4.1],['2025-01-01',.7]]){
    const delta=longitudinalChange(data,'poverty',from,'2026-01-01');
    assert.equal(delta.comparable,true);assert.ok(Math.abs(delta.delta-expected)<1e-10);assert.equal(delta.unit,'percentage points');
  }
});

test('WDI values and complementary employment/equality measures reproduce from the archived producer records',async()=>{
  let checked=0;const cache=new Map();
  for(const row of data.observations){
    if(!row.source_id?.startsWith('wdi-'))continue;
    if(['gini','equality'].includes(row.indicator_id)&&row.period_start.endsWith('-01-01')){assert.equal(row.value,null);continue;}
    if(!cache.has(row.source_id))cache.set(row.source_id,await json(data.sources.find(s=>s.id===row.source_id).path));
    const source=cache.get(row.source_id)[1].find(r=>r.countryiso3code==='ARG'&&Number(r.date)===row.observation_year);
    assert.ok(source,`${row.indicator_id} ${row.period_start}`);
    const expected=source.value===null?null:['employment','equality'].includes(row.indicator_id)?100-source.value:source.value;
    if(expected===null)assert.equal(row.value,null);else assert.ok(row.value!==null&&Math.abs(row.value-expected)<1e-9,`${row.indicator_id} ${row.period_start}`);checked++;
  }
  // 195 source reporting periods; the 26 deliberately absent H1 Gini/equality
  // placeholders are checked separately above and must never borrow an H2 value.
  assert.equal(checked,195);
});

test('released manuscripts and figures retain the evidence boundaries and contain no private accounting fields',async()=>{
  for(const name of ['argentina-working-paper','methods-paper']){
    const html=await readFile(path.join(root,`${name}.html`),'utf8');
    assert.match(html,/Working manuscript, not peer reviewed/);assert.match(html,/preliminary/);
    assert.doesNotMatch(html,/research[_ -]cost|input_tokens|output_tokens|ANTHROPIC_API_KEY|estimated_cost_usd/i);
    for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)){
      if(match[1].startsWith('https://'))continue;
      const file=await realpath(path.resolve(root,match[1]));assert.ok(file===root||file.startsWith(root+path.sep));
    }
  }
});

test('the downloadable papers, plots and data remain bound to the independent review record',async()=>{
  const review=await json('data/independent-review.json');
  for(const [file,hash] of Object.entries(review.reviewed_files)){
    const bytes=await readFile(path.join(root,file));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);
    if(file.endsWith('.pdf'))assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  }
});
