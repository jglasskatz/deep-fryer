import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionState, dimensionStatus, regionSummary } from '../site/portrait-presentation.js';
test('a missing score distinguishes available values from missing data without inferring a score', () => {
 const dimension={ring:'social',level:null,indicators:[{value:null}]};
 assert.equal(dimensionState(dimension),'unknown');assert.equal(dimensionStatus(dimension),'Data needed');
 const observed={...dimension,indicators:[{value:0,kind:'observation'}]};
 assert.equal(dimensionState(observed),'unscored');assert.equal(dimensionStatus(observed),'Unscored observation');assert.equal(observed.level,null);
 assert.equal(dimensionState({...dimension,indicators:[{value:12}]}),'unscored');
 assert.equal(dimensionState({...dimension,level:0}),'within');
});
test('geography summary uses complete source text, never a truncated geographic claim',()=>{
 assert.equal(regionSummary({region:'Coastal city in Monterey Bay. Local context follows.',group:'Santa Cruz'}),'Coastal city in Monterey Bay.');
 assert.equal(regionSummary({region:'A'.repeat(121),group:'Santa Cruz'}),'Santa Cruz portrait');
});
