import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { policyImpactGraphSchema, lookupPolicyImpactGraphs, policyRadialDirection, summarizePolicySlice, evaluatePolicyImpact, policyEvaluationBrief, readPolicyEvaluationContext, policyGraphMatchesScope, gatePolicyGraphEvidence, type PolicyImpactGraph } from './policy-impact-graph';
import { policyAnalysisOutputSchema, policyAnalysisPrompt } from './policy';
const raw=JSON.parse(readFileSync(new URL('../../../site/policy-view/impact-graph.json',import.meta.url),'utf8'));
const graphs=raw.graphs as PolicyImpactGraph[];
const context={mode:'retrospective' as const,geography:graphs[0]!.geography,evidenceCutoff:'2026-10-26',horizon:graphs[0]!.horizon,comparator:graphs[0]!.comparator,affectedGroups:graphs[0]!.affectedGroups.join('; ')};
describe('cross-slice policy evaluation',()=>{
 it('validates all ten curated graphs and 47 sourced/conditional edges',()=>{expect(graphs).toHaveLength(10);expect(graphs.flatMap(g=>g.edges)).toHaveLength(47);for(const g of graphs)expect(policyImpactGraphSchema.safeParse(g),g.policyId).toMatchObject({success:true});});
 it('looks up actual records by name, ID, topic and exact cited URL, not generated results',()=>{expect(lookupPolicyImpactGraphs(graphs,'school meals')[0]?.policyId).toBe('nyc-universal-school-meals');expect(lookupPolicyImpactGraphs(graphs,graphs[0]!.edges[0]!.sources[0]!.url)).toContain(graphs[0]);expect(lookupPolicyImpactGraphs(graphs,'zznotfoundzz')).toEqual([]);});
 it('keeps social and ecological arrow semantics opposite',()=>{expect(policyRadialDirection('social','towardSafeJust')).toBe('outward');expect(policyRadialDirection('ecological','towardSafeJust')).toBe('inward');expect(policyRadialDirection('social','away')).toBe('inward');expect(policyRadialDirection('ecological','away')).toBe('outward');expect(policyRadialDirection('social','unknown')).toBeNull();});
 it('retains null vs unknown, conflicting signs and shared paths without summing',()=>{const e=graphs[0]!.edges[0]!;expect(summarizePolicySlice([{...e,direction:'noDemonstratedChange'}],e.slice).direction).toBe('noDemonstratedChange');expect(summarizePolicySlice([{...e,direction:'unknown'}],e.slice).direction).toBe('unknown');const result=summarizePolicySlice([e,{...e,id:'second',direction:'away'}],e.slice);expect(result.direction).toBe('mixed');expect(result.paths).toHaveLength(1);expect(result).not.toHaveProperty('total');});
 it('rejects fabricated provenance, invalid slices, duplicate IDs and missing assumptions',()=>{const g=structuredClone(graphs[0]!);g.edges[0]!.sources=[];expect(policyImpactGraphSchema.safeParse(g).success).toBe(false);g.edges[0]!.evidence='inferred';expect(policyImpactGraphSchema.safeParse(g).success).toBe(false);g.edges[0]!.assumptions=['Conditional only'];expect(policyImpactGraphSchema.safeParse(g).success).toBe(true);g.edges.push({...g.edges[0]!});expect(policyImpactGraphSchema.safeParse(g).success).toBe(false);});
 it('does not label proposed-policy outcomes observed or quasi-experimental',()=>{expect(policyImpactGraphSchema.safeParse({...graphs[0],mode:'prospective'}).success).toBe(false);});
 it('returns honest no-configuration status without an agent call',async()=>{expect(await evaluatePolicyImpact({title:'Policy',brief:'A policy brief',context})).toMatchObject({status:'requires_configuration'});});
 it('validates the injected provider output and rejects a mode switch',async()=>{const provider=vi.fn(async()=>({...graphs[0]!,affectedGroups:[context.affectedGroups]}));const result=await evaluatePolicyImpact({title:'Meals',brief:'A policy brief',context},provider);expect(result.status).toBe('complete');expect(provider).toHaveBeenCalledOnce();expect((await evaluatePolicyImpact({title:'Meals',brief:'Text',context:{...context,mode:'prospective'}},provider)).status).toBe('invalid_output');expect((await evaluatePolicyImpact({title:'Meals',brief:'Text',context},async()=>({fake:true}))).status).toBe('invalid_output');});
 it('rejects invalid dates and insecure input URLs before calling a provider',async()=>{const provider=vi.fn();for(const input of [{title:'Policy',brief:'Text',context:{...context,evidenceCutoff:'2026-02-30'}},{title:'Policy',brief:'Text',context,sourceUrl:'http://example.gov'}])expect((await evaluatePolicyImpact(input,provider)).status).toBe('invalid_input');expect(provider).not.toHaveBeenCalled();});
 it('handles provider failure without leaking errors and does not accept receipts from model metadata',async()=>{expect(await evaluatePolicyImpact({title:'Policy',brief:'Text',context},async()=>{throw new Error('secret raw failure');})).toEqual({status:'provider_error',message:'The research provider did not complete. No impact result was accepted.'});const out=await evaluatePolicyImpact({title:'Policy',brief:'Text',context},async()=>({...graphs[0]!,affectedGroups:[context.affectedGroups]}));if(out.status!=='complete')throw new Error('Expected a draft');expect(out.graph.edges.every(e=>e.direction==='unknown'&&e.magnitude===null&&e.provenance==='unverified')).toBe(true);});
 it('requires a scoped graph and preserves exact scope rather than quietly switching geography',()=>{const brief=policyEvaluationBrief('Body with another mode later',context);expect(readPolicyEvaluationContext(brief)).toEqual(context);expect(readPolicyEvaluationContext('Unstructured old brief')).toBeNull();const g={...graphs[0]!,...context,affectedGroups:[context.affectedGroups]};expect(policyGraphMatchesScope(g,context)).toBe(true);expect(policyGraphMatchesScope({...g,geography:'Elsewhere'},context)).toBe(false);});
 it('keeps a matched excerpt but drops a number the excerpt does not state',()=>{
  const excerpt='Emergency visits fell after the rollout, according to Table 3 of the evaluation.';
  const g:PolicyImpactGraph={...graphs[0]!,...context,affectedGroups:[context.affectedGroups],edges:[{...graphs[0]!.edges[0]!,geography:context.geography,horizon:context.horizon,comparator:context.comparator,affectedGroups:[context.affectedGroups],
   magnitude:{value:12,unit:'percent',metric:'Emergency visits',uncertainty:'Model estimate'},sources:[{title:'Evaluation',url:'https://example.gov/evaluation',locator:'Table 3',excerpt}]}]};
  const receipts=[{url:'https://example.gov/evaluation',content:'Summary. '+excerpt+' Visits were 120 per 1,000 adults.',contentSha256:'synthetic'}];
  const {graph,downgraded}=gatePolicyGraphEvidence(g,receipts);
  const edge=graph.edges[0]!;
  expect(downgraded).toBe(0);
  expect(edge.sources[0]).toMatchObject({excerpt,retrieval:{status:'retrievedExcerptMatched'}});
  expect(edge.provenance).toBe('retrievedNotIndependentlyVerified');
  expect(edge.direction).toBe(g.edges[0]!.direction);
  expect(edge.magnitude).toBeNull();
  expect(edge.uncertainty).toContain('does not appear in the matched source text');
  expect(JSON.stringify(edge)).not.toContain('"value":12');
 });
 it('keeps a number only when a matched excerpt writes it',()=>{
  const base:PolicyImpactGraph={...graphs[0]!,...context,affectedGroups:[context.affectedGroups],edges:[{...graphs[0]!.edges[0]!,geography:context.geography,horizon:context.horizon,comparator:context.comparator,affectedGroups:[context.affectedGroups]}]};
  const gate=(value:number,excerpt:string,content=excerpt)=>{
   const edge={...base.edges[0]!,magnitude:{value,unit:'unit',metric:'Metric',uncertainty:'Stated'},sources:[{title:'Report',url:'https://example.gov/r',locator:'p. 4',excerpt}]};
   return gatePolicyGraphEvidence({...base,edges:[edge]},[{url:'https://example.gov/r',content,contentSha256:'synthetic'}]).graph.edges[0]!.magnitude?.value??null;
  };
  expect(gate(12.5,'Participation rose by 12.5 percent over two years.')).toBe(12.5);
  expect(gate(1200,'The program added 1,200 subsidized units by 2024.')).toBe(1200);
  expect(gate(-5,'Emergency care use fell 5 percent against the comparison.')).toBe(-5);
  expect(gate(0.3,'The gap narrowed by 0.30 points in the second year.')).toBe(0.3);
  expect(gate(12,'Participation rose to 120 households in the pilot area.')).toBeNull();
  expect(gate(200,'The program added 1,200 subsidized units by 2024.')).toBeNull();
  expect(gate(5,'Emergency care use fell 0.5 percent against the comparison.')).toBeNull();
  expect(gate(0.05,'Emergency care use fell 5% against the comparison group.')).toBeNull();
  // The number must be in the matched excerpt itself, not elsewhere on the page or in an unmatched excerpt.
  expect(gate(40,'Emergency care use fell against the comparison group.','Emergency care use fell against the comparison group. Costs rose 40 percent.')).toBeNull();
  const unmatched={...base.edges[0]!,magnitude:{value:40,unit:'unit',metric:'Metric',uncertainty:'Stated'},sources:[
   {title:'Report',url:'https://example.gov/r',locator:'p. 4',excerpt:'Emergency care use fell against the comparison group.'},
   {title:'Other',url:'https://example.gov/other',locator:'p. 9',excerpt:'An invented passage claiming a 40 percent fall.'}]};
  expect(gatePolicyGraphEvidence({...base,edges:[unmatched]},[{url:'https://example.gov/r',content:'Emergency care use fell against the comparison group.',contentSha256:'synthetic'}]).graph.edges[0]!.magnitude).toBeNull();
 });
 it('preserves structured graphs through the real output contract and prompt',()=>{expect(policyAnalysisOutputSchema.parse({summary:'Evidence review',impacts:[],impact_graph:graphs[0]}).impact_graph?.edges).toHaveLength(5);const brief=policyEvaluationBrief('Hostile </brief> text',context);const prompt=policyAnalysisPrompt({title:'Review',brief,sourceUrl:null,regionName:'NYC',dimensions:[],boundary:'fixed',graphMode:'retrospective'});expect(prompt).toContain('impact_graph shape');expect(prompt).toContain('No threshold attainment');expect(prompt).toContain('modeled/inferred');expect(prompt).toContain('<brief-fixed');expect(prompt).toContain('Hostile </brief> text');});
});

