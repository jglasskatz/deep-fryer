// Source-wiring regression guards; these do not replace server/browser integration tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
test('server action and worker reserve the published-baseline requirement for baseline mode',()=>{
 const action=read('apps/web/lib/policy-actions.ts');
 const worker=read('apps/worker/src/tasks/policy-analyze.ts');
 assert.match(action,/!fields\.evaluationContext && !portrait\?\.dimensions\.length/);
 assert.match(worker,/!requestedScope && !published\.length/);
 assert.match(worker,/!requestedScope && parsed\.data\.impact_graph/);
 assert.match(worker,/delete parsed\.data\.impact_graph/);
 assert.match(worker,/portrait_baseline: portraitBaseline/);
});
test('UI exposes all modes without globally blocking graph mode on an empty portrait',()=>{
 const form=read('apps/web/components/policy/NewPolicyForm.tsx');
 for(const mode of ['baseline','retrospective','prospective']) assert.ok(form.includes('value="'+mode+'"'));
 assert.match(form,/analysisMode === 'baseline' && !hasPublishedBaseline/);
 assert.match(read('apps/web/app/[tenant]/admin/policy/page.tsx'),/blockedReason=\{blockedReason\(billing\)\}/);
});
test('both graph renderers disclose unresolved pathways without hover',()=>{
 assert.match(read('apps/web/components/policy/PolicyImpactGraph.tsx'),/aria-label="Unresolved pathways"/);
 assert.match(read('site/policy-view/policy-evaluator.js'),/aria-label="Unresolved pathways"/);
});

test('the worker uses deterministic gated graph prose, not the provider summary',()=>{
 const worker=read('apps/worker/src/tasks/policy-analyze.ts');
 assert.match(worker,/parsed\.data\.summary = policyGraphEvidenceSummary\(gated\.graph\)/);
 assert.doesNotMatch(worker,/\+ parsed\.data\.summary/);
 const graphOnly=worker.slice(worker.indexOf('if (parsed.data.impact_graph) {'),worker.indexOf('// Graph-backed analyses'));
 for(const field of ['impacts','assumptions','risks']) assert.ok(graphOnly.includes('parsed.data.'+field+' = [];'));

});

test('conditional scenario exports do not inherit retrospective source-review status',()=>{
 const engine=read('site/policy-view/impact-engine.js');
 assert.match(engine,/status:'unverified_conditional_scenario'/);
 assert.match(engine,/human_approved:false/);
});
