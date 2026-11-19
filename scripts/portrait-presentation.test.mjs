import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionColour, dimensionState, dimensionStatus, hasValue, regionSummary } from '../site/portrait-presentation.js';
test('a missing score distinguishes available values from missing data without inferring a score', () => {
 const dimension={ring:'social',level:null,indicators:[{value:null}]};
 assert.equal(dimensionState(dimension),'unknown');assert.equal(dimensionStatus(dimension),'Data needed');
 const observed={...dimension,indicators:[{value:0,kind:'observation'}]};
 assert.equal(dimensionState(observed),'unscored');assert.equal(dimensionStatus(observed),'Unscored observation');assert.equal(observed.level,null);
 assert.equal(dimensionState({...dimension,indicators:[{value:12}]}),'unscored');
 assert.equal(dimensionState({...dimension,level:0}),'within');
});
test('unscored values use neutral grey without changing data or hiding selection', () => {
 const unscored={ring:'ecological',level:null,indicators:[{value:'25.2% / 16.2%'}]};
 const before=structuredClone(unscored);
 assert.equal(dimensionColour(unscored),'#777777');
 assert.equal(dimensionColour(unscored,true),'#0066cc');
 assert.deepEqual(unscored,before);
 assert.equal(dimensionStatus(unscored),'Value available · score unknown');
 assert.equal(dimensionColour({...unscored,indicators:[{value:null}]}),null,'Data gaps retain renderer pale grey');
 assert.equal(dimensionColour({...unscored,level:0}),'#8cd755','Zero has a green label marker without a fabricated bar');
 assert.equal(dimensionColour({...unscored,level:40}),null);
});
test('geography summary uses complete source text, never a truncated geographic claim',()=>{
 assert.equal(regionSummary({region:'Coastal city in Monterey Bay. Local context follows.',group:'Santa Cruz'}),'Coastal city in Monterey Bay.');
 assert.equal(regionSummary({region:'A'.repeat(121),group:'Santa Cruz'}),'Santa Cruz portrait');
});
test('explicit missing-data text is a gap, while zero and qualitative observations remain available', () => {
 for (const value of [null, undefined, '', '  ', NaN, Infinity, 'Data not available at city level', ' data NOT available at city level ', 'Not available', 'N/A', 'Unknown']) {
  const dimension = {ring:'ecological',level:null,indicators:[{value}]};
  assert.equal(dimensionState(dimension), 'unknown', String(value));
  assert.equal(dimensionStatus(dimension), 'Data needed', String(value));
 }
 for (const value of [0, '0', 'Meets all EPA & state standards (detailed data pending)', '51% renewable grid; 3CE available']) {
  assert.equal(dimensionState({level:null,indicators:[{value}]}), 'unscored', String(value));
 }
 assert.equal(dimensionState({level:null,indicators:[{value:'placeholder',status:'gap'}]}), 'unknown');
 assert.equal(dimensionState({level:null,indicators:[{value:'Not available'},{value:0}]}), 'unscored');
});

test('a gap marker that also reports a number is a value, while a bare or located gap is not', () => {
 for (const value of ['Data not available at city level (county: 12.3 mg/L)', 'Not available for 2024; 2022 value was 41%', 'Not available in 41 census tracts']) {
  assert.equal(hasValue({value}), true, value);
 }
 for (const value of ['Data not available at city level', 'Not available for 2024', 'Not reported for 2022-23.', 'Value unavailable in Santa Cruz']) {
  assert.equal(hasValue({value}), false, value);
 }
});

test('within-target label is green without changing zero magnitude or selection', () => {
 const zero={ring:'ecological',level:0,indicators:[{value:'No overshoot',level_pct:0}]};
 const before=structuredClone(zero);
 assert.equal(dimensionColour(zero),'#8cd755');
 assert.equal(dimensionColour(zero,true),'#0066cc');
 assert.equal(dimensionStatus(zero),'Within target');
 assert.deepEqual(zero,before);
});
