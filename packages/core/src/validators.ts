import { z } from 'zod';

export const ringSchema = z.enum(['social', 'ecological']);
export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export const roleSchema = z.enum(['owner', 'editor', 'viewer', 'moderator']);
export const versionStatusSchema = z.enum(['draft', 'published', 'archived']);
export const versionOriginSchema = z.enum(['research', 'human', 'import']);
export const geographicScaleSchema = z.enum([
  'city',
  'county',
  'regional',
  'state',
  'national',
  'global',
]);
export const mappingFunctionSchema = z.enum(['higher_is_better', 'lower_is_better', 'band']);
export const contentSupportedSchema = z.enum(['pass', 'fail', 'uncertain']);

export const indicatorScoringSchema = z.object({
  threshold_ref: z.string(),
  function: mappingFunctionSchema,
  inputs: z.record(z.number()),
  worked_math: z.string(),
});

export const indicatorEvidenceSchema = z.object({
  snapshot_path: z.string(),
  pdf_path: z.string().optional(),
  captured_at: z.string(),
});

export const indicatorSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  unit: z.string(),
  year: z.number().int().nullable(),
  target: z.union([z.number(), z.string(), z.null()]),
  level_pct: z.number().optional(),
  scoring: indicatorScoringSchema.optional(),
  source: z.string(),
  source_url: z.string(),
  source_tier: z.number().int().min(1).optional(),
  evidence: indicatorEvidenceSchema.optional(),
  confidence: confidenceSchema,
  geographic_scale: geographicScaleSchema,
  supporting_source_url: z.string().optional(),
});

export const dimensionGapSchema = z.object({
  indicator: z.string(),
  reason: z.string(),
  scales_tried: z.array(geographicScaleSchema),
  searched_at: z.string(),
});

export const dimensionDataSchema = z.object({
  name: z.string(),
  icon: z.string(),
  description: z.string(),
  context: z.string(),
  indicators: z.array(indicatorSchema),
  gaps: z.array(dimensionGapSchema).optional(),
  actions: z.array(z.string()),
  policy_spotlight: z.string().optional(),
  justice_spotlight: z.string().optional(),
});

export const outreachContactDataSchema = z.object({
  org: z.string(),
  person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  tags: z.array(z.string()),
  data_needs: z.array(z.string()),
  why: z.string().optional(),
  draft_message: z.string().optional(),
});

export const tenantBrandingSchema = z.object({
  logo_url: z.string().optional(),
  primary_color: z.string().optional(),
  font: z.string().optional(),
  footer_html: z.string().optional(),
});

// ---- Findings (the research boundary; mirrors contract/schemas/finding.schema.json) ----

export const indicatorFindingPayloadSchema = z.object({
  kind: z.literal('indicator'),
  indicator_slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  unit: z.string(),
  year: z.number().int().min(1900).max(2100),
  target: z.union([z.number(), z.string()]),
  level_pct: z.number(),
  scoring: indicatorScoringSchema,
  source: z.string().min(1),
  source_url: z.string().url(),
  source_tier: z.number().int().min(1),
  evidence: indicatorEvidenceSchema,
  confidence: confidenceSchema,
  geographic_scale: geographicScaleSchema,
  notes: z.string().optional(),
});

export const gapFindingPayloadSchema = z.object({
  kind: z.literal('gap'),
  indicator_slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  reason: z.string().min(1),
  scales_tried: z.array(geographicScaleSchema).min(1),
  tiers_tried: z.array(z.number().int().min(1)).optional(),
  searched_at: z.string(),
  nearest_data: z.string().optional(),
});

export const findingPayloadSchema = z.discriminatedUnion('kind', [
  indicatorFindingPayloadSchema,
  gapFindingPayloadSchema,
]);

export const findingVerificationSchema = z.object({
  url_ok: z.boolean(),
  schema_ok: z.boolean(),
  recency_ok: z.boolean(),
  scale_ok: z.boolean(),
  content_supported: contentSupportedSchema,
  verifier_note: z.string().optional(),
});

// ---- Tenant config (SPEC.md §6; portrait keys mirror portrait-config.schema.json) ----

export const sourceTierSchema = z.object({
  tier: z.number().int().min(1),
  name: z.string(),
  description: z.string(),
  examples: z.array(z.string()).optional(),
});

export const regionConfigSchema = z.object({
  name: z.string().min(1),
  definition: z.string().min(1),
  context_notes: z.string().optional(),
});

export const sourcePriorityConfigSchema = z.object({
  tiers: z.array(sourceTierSchema).min(1),
});

export const recencyConfigSchema = z.object({
  default_max_age_years: z.number().int().min(1),
  per_dimension: z.record(z.number().int().min(1)).optional(),
});

export const scalePolicyConfigSchema = z.object({
  default_accepted: z.array(geographicScaleSchema).min(1),
  per_dimension: z.record(z.array(geographicScaleSchema).min(1)).optional(),
});

export const thresholdOverrideSchema = z.object({
  target: z.number(),
  scale: z.number().positive().optional(),
  function: mappingFunctionSchema.optional(),
  low: z.number().optional(),
  high: z.number().optional(),
  rationale: z.string().min(1),
});

export const thresholdOverridesConfigSchema = z.record(thresholdOverrideSchema);

export const reviewPolicyConfigSchema = z.object({
  require_approval: z.enum(['all', 'none']),
  dual_review_on_edits: z.boolean(),
  first_post_requires_approval: z.boolean(),
});

export const retentionConfigSchema = z.object({
  transcript_days: z.number().int().min(1),
});

export const notificationConfigSchema = z.object({
  email_on_run_complete: z.boolean(),
  email_on_flagged_finding: z.boolean(),
});

/** Per-key validators for the tenant_config table — the settings write path. */
export const tenantConfigSchemas = {
  region: regionConfigSchema,
  source_priority: sourcePriorityConfigSchema,
  recency: recencyConfigSchema,
  scale_policy: scalePolicyConfigSchema,
  threshold_overrides: thresholdOverridesConfigSchema,
  review_policy: reviewPolicyConfigSchema,
  retention: retentionConfigSchema,
  notifications: notificationConfigSchema,
} as const;

export type TenantConfigSchemaKey = keyof typeof tenantConfigSchemas;
