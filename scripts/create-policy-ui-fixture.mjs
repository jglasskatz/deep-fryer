/** Synthetic private analysis for local browser QA. Never queues research or changes a portrait. */
import { getDb, tenantBySlug, publishedDoughnut, policyAnalyses, provisionTenant, dimensions, appendDimensionVersion, tenantConfig } from '@deep-fryer/db';
import { freezePolicyPortrait, projectDimensions, computeScoring, deriveVizLevel, SAMPLE_DATA_CONFIG_KEY } from '@deep-fryer/core';
import { and, eq } from 'drizzle-orm';

const url = new URL(process.env.DATABASE_URL ?? '');
if (process.env.ALLOW_MUTATING_UI_FIXTURES !== '1' || process.env.NODE_ENV === 'production'
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/\b(test|ci|20261029)\b/.test(url.pathname.replace(/_/g, ' '))) {
  throw new Error('Requires an explicitly opted-in isolated local test database');
}
const slug = process.env.UI_TEST_TENANT || 'nyc';
const db = getDb();
// CI starts with an empty database. Opt-in seeding creates a dedicated synthetic
// tenant only; an existing tenant is never overwritten by this branch.
if(process.env.UI_TEST_SEED_TENANT==='1') {
  if(!slug.startsWith('ui-policy-')||await tenantBySlug(db,slug))throw new Error('Seed requires a new ui-policy-* tenant');
  const {tenant}=await provisionTenant(db,{slug,name:'Synthetic policy UI test'});
  await db.insert(tenantConfig).values({tenantId:tenant.id,key:SAMPLE_DATA_CONFIG_KEY,value:true});
  await db.insert(tenantConfig).values({tenantId:tenant.id,key:'features',value:{policy_analysis:true}}).onConflictDoUpdate({target:[tenantConfig.tenantId,tenantConfig.key],set:{value:{policy_analysis:true}}});
  const [dim]=await db.select().from(dimensions).where(and(eq(dimensions.tenantId,tenant.id),eq(dimensions.slug,'housing')));
  const scored=computeScoring(52,'synthetic.rent',{function:'lower_is_better',target:30,scale:30,rationale:'Synthetic UI test only'});
  const data={name:'Housing',icon:'',description:'Synthetic fixture',context:'Not research',actions:[],indicators:[{name:'Synthetic rent burden',value:52,unit:'%',year:2023,target:30,...scored,source:'SYNTHETIC DEMO VALUE — not research',source_url:'https://example.org/synthetic-policy-ui-fixture',confidence:'low',geographic_scale:'city'}]};
  const version=await appendDimensionVersion(db,{dimensionId:dim.id,status:'published',publishedAt:new Date(),origin:'import',data,vizLevel:deriveVizLevel(data)});
  await db.update(dimensions).set({publishedVersionId:version.id}).where(eq(dimensions.id,dim.id));
}
const tenant = await tenantBySlug(db, slug);
const portrait = await publishedDoughnut(db, slug);
if (!tenant || !portrait?.dimensions?.length) throw new Error('A seeded local published portrait is required');
const dimension = portrait.dimensions.find(d => d.data.indicators.some(i => i.value !== null && i.scoring));
if (!dimension) throw new Error('Fixture needs a scored indicator');
const indicator = dimension.data.indicators.find(i => i.value !== null && i.scoring);
const projected = indicator.value * (indicator.scoring.function === 'higher_is_better' ? 1.1 : 0.9);
const impacts = [{
  dimension_slug: dimension.slug, direction: 'improves', magnitude: 'small', confidence: 'low',
  rationale: 'Synthetic interface fixture. This value is deliberately fabricated for testing and is not research or a policy recommendation.',
  indicator: indicator.name, projected_value: projected, projected_unit: indicator.unit,
  projected_year: Math.max(2027, (indicator.year ?? 2026) + 1),
  uncertainty: { lower: Math.min(projected * 0.9, projected * 1.1), upper: Math.max(projected * 0.9, projected * 1.1), method: 'Synthetic display bounds only; not a confidence interval.' },
  sources: [{ title: 'Synthetic test reference, not evidence', url: 'https://example.org/synthetic-policy-ui-fixture' }],
}];
const values = {
  id: '967edc27-3b31-4bfe-ae4c-5e01f3f8f69e', tenantId: tenant.id,
  title: 'Synthetic policy interface fixture',
  brief: 'LOCAL UI TEST ONLY. No model request, causal finding or public publication.',
  status: 'complete', completedAt: new Date(),
  result: {
    schema_version: 2,
    summary: 'Synthetic scenario for verifying the interface. The proposed values and bounds are fabricated test inputs.',
    assumptions: ['No empirical or causal interpretation is permitted.'],
    risks: ['This fixture must stay in an isolated local test database.'],
    impacts, portrait_baseline: freezePolicyPortrait(portrait.dimensions),
  },
  projections: projectDimensions(portrait.dimensions, impacts),
};
await db.insert(policyAnalyses).values(values).onConflictDoUpdate({ target: policyAnalyses.id, set: values });
console.log(JSON.stringify({ synthetic: true, route: `/${slug}/admin/policy/${values.id}`, quantified: values.projections.some(p => p.indicator_changes.length) }));
process.exit(0);
