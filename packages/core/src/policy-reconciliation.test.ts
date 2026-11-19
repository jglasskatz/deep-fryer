import { describe, expect, it } from 'vitest';
import { framework } from '@deep-fryer/contract';
import { policyAnalysisPrompt, policyAnalysisOutputSchema } from './policy';
import { gatePolicyGraphEvidence, policyGraphEvidenceSummary, policyGraphMatchesScope, policyEdgeScopeWarnings, summarizePolicySlice, type PolicyImpactGraph, type PolicyImpactEdge } from './policy-impact-graph';

const scope = {mode:'retrospective' as const, geography:'Test city', evidenceCutoff:'2026-10-26', horizon:'2020–2025', comparator:'No policy', affectedGroups:'Residents'};
const edge: PolicyImpactEdge = {
 id:'one', slice:framework.dimensions[0]!.slug as PolicyImpactEdge['slice'], direction:'towardSafeJust',
 evidence:'observed', link:'direct', outcome:'An observed indicator changed; attribution is unestablished.', pathId:'one',
 mechanism:'Hypothesis to review', geography:scope.geography, horizon:scope.horizon, comparator:scope.comparator,
 affectedGroups:[scope.affectedGroups], magnitude:null, uncertainty:'No causal identification', assumptions:[], validation:'Review claim and design',
 sources:[{title:'Synthetic source',url:'https://example.org/report',locator:'p.1',excerpt:'This is source text, not proof of the model claim.'}], provenance:'unverified',
};
const graph: PolicyImpactGraph = {...scope, affectedGroups:[scope.affectedGroups],policyId:'test',title:'Test policy',assumptions:[],costs:[],validation:['Review'],edges:[edge]};
const receipts=[{url:'https://example.org/report',content:edge.sources[0]!.excerpt!,contentSha256:'synthetic-receipt'}];
describe('policy mode reconciliation (synthetic, no provider)',()=>{
 it('keeps legacy baseline prompts and saved output free of an unsolicited graph',()=>{
  const prompt=policyAnalysisPrompt({title:'Policy',brief:'Text',sourceUrl:null,regionName:'City',dimensions:[],boundary:'fixture'});
  expect(prompt).not.toContain('impact_graph shape');
  expect(prompt).toContain('Do not return impact_graph');
  expect(policyAnalysisOutputSchema.parse({schema_version:2,summary:'Saved baseline',impacts:[]})).not.toHaveProperty('impact_graph');
 });
 it.each(['retrospective','prospective'] as const)('explicitly supports %s graphs without claiming custom-dimension alignment',mode=>{
  const prompt=policyAnalysisPrompt({title:'Policy',brief:'Text',sourceUrl:null,regionName:'City',dimensions:[],graphMode:mode,boundary:'fixture'});
  expect(prompt).toContain('impact_graph shape');
  expect(prompt).toContain('canonical framework slices, not custom portrait addresses');
  for(const d of framework.dimensions) expect(prompt).toContain(`${d.slug} | ${d.name} | ${d.ring}`);
  expect(policyGraphMatchesScope({...graph,mode},{...scope,mode})).toBe(true);
 });
 it('lists canonical graph categories separately from a custom portrait address',()=>{
  const dimensions=[{slug:'custom-heat',viz_level:null,data:{name:'Local heat',indicators:[]}}] as unknown as Parameters<typeof policyAnalysisPrompt>[0]['dimensions'];
  const prompt=policyAnalysisPrompt({title:'Policy',brief:'Text',sourceUrl:null,regionName:'City',dimensions,graphMode:'prospective',boundary:'fixture'});
  expect(prompt).toContain('custom-heat (Local heat)');
  expect(prompt).toContain('Canonical graph categories (slug | name | ring)');
  for(const d of framework.dimensions) expect(prompt).toContain(`${d.slug} | ${d.name} | ${d.ring}`);
  expect(prompt).toContain('do not rename or map them to canonical categories');
 });
 it('rejects a changed requested population, date or geography',()=>{
  expect(policyGraphMatchesScope({...graph,affectedGroups:['Other residents']},scope)).toBe(false);
  expect(policyGraphMatchesScope({...graph,evidenceCutoff:'2026-10-27'},scope)).toBe(false);
  expect(policyGraphMatchesScope({...graph,geography:'Other city'},scope)).toBe(false);
 });
 it.each(['geography','horizon','comparator'] as const)('downgrades a retrieved claim with a different %s',key=>{
  const changed={...edge,[key]:'Other scope'};
  expect(policyEdgeScopeWarnings(graph,changed)).not.toEqual([]);
  expect(gatePolicyGraphEvidence({...graph,edges:[changed]},receipts).graph.edges[0]).toMatchObject({direction:'unknown',magnitude:null,evidence:'inferred'});
 });
 it('does not treat source matching as independent claim verification or human approval',()=>{
  const result=gatePolicyGraphEvidence(graph,receipts).graph;
  expect(result.edges[0]!.provenance).toBe('retrievedNotIndependentlyVerified');
  expect(result.review?.human_approved).toBe(false);
  expect(gatePolicyGraphEvidence({...graph,edges:[{...edge,affectedGroups:['Other group']}]},receipts).graph.edges[0]!.direction).toBe('unknown');
 });
 it('never promotes an unsupported causal number through the primary graph summary',()=>{
  const unsupported={...graph,edges:[{...edge,outcome:'The policy caused a 97 percent reduction.',magnitude:{value:97,unit:'percent',metric:'Claim',uncertainty:'Unsupported'}}]};
  const gated=gatePolicyGraphEvidence(unsupported,[]).graph;
  const summary=policyGraphEvidenceSummary(gated);
  expect(summary).toContain('1 unknown');
  expect(summary).not.toContain('97');
  expect(summary).not.toContain('caused');
  expect(summary).toContain('not independently validated policy effects');
 });
 it('retains unresolved count beside positive evidence rather than erasing it',()=>{
  const result=summarizePolicySlice([edge,{...edge,id:'unknown',direction:'unknown'}],edge.slice);
  expect(result.direction).toBe('towardSafeJust');
  expect(result.unresolved).toBe(1);
 });
});
