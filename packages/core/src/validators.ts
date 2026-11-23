import { z } from 'zod';
import { INDICATOR_KEY_PATTERN } from './indicator-keys.js';
import { boundedRecord, REQUEST_LIMITS as R } from './request-limits.js';

// ---- String formats ----
//
// zod 4's format schemas check differently from the zod 3 methods these
// schemas used: z.url() trims and rewrites the value, z.email() has its own
// pattern, z.iso.datetime() requires seconds and a colon in the offset. The
// stored and published shapes must accept exactly what they accepted before,
// so the checks are spelled out here.

/** The email addresses accepted (zod 3's email pattern). */
export const EMAIL_PATTERN = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

/** An email check to add to a string schema with `.check()`, after any trim. */
export function emailFormat(error?: string) {
  return z.email({ pattern: EMAIL_PATTERN, ...(error ? { error } : {}) });
}

/** True when the WHATWG URL parser reads the string as written. The value is never trimmed or rewritten. */
export function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** The message for a string that is not a URL. */
export const INVALID_URL = 'Invalid URL';

const DATE_SOURCE =
  '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))';

/**
 * An ISO 8601 date and time with a Z or numeric offset: seconds and
 * fractions optional, offsets written +hh:mm or +hhmm (zod 3's
 * datetime({ offset: true })).
 */
export const ISO_DATETIME_OFFSET_RE = new RegExp(
  `^${DATE_SOURCE}T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|([+-]\\d{2}:?\\d{2}))$`,
);

/** A timestamp string with a Z or numeric offset. */
export function isoDatetime() {
  return z.string().regex(ISO_DATETIME_OFFSET_RE, 'Invalid ISO datetime');
}

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export const geographicScaleSchema = z.enum([
  'city',
  'county',
  'regional',
  'state',
  'national',
  'global',
]);
export const mappingFunctionSchema = z.enum(['higher_is_better', 'lower_is_better', 'band']);

export const indicatorScoringSchema = z.object({
  threshold_ref: z.string(),
  function: mappingFunctionSchema,
  inputs: boundedRecord(z.string(), z.number(), R.scoringInputs),
  worked_math: z.string(),
});

/** Where capture_evidence stores a page's readable text: evidence/<name>.txt. */
export const EVIDENCE_TEXT_PATH_RE = /^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.txt$/;

export const indicatorEvidenceSchema = z.object({
  snapshot_path: z.string(),
  pdf_path: z.string().optional(),
  // Both optional: evidence captured before text was kept has neither.
  text_path: z.string().regex(EVIDENCE_TEXT_PATH_RE).optional(),
  no_readable_text: z.literal(true).optional(),
  captured_at: z.string(),
});

export const sourcedActionSchema = z.object({
  text: z.string().trim().min(1).max(400),
  source_url: z.string().refine(isParseableUrl, INVALID_URL).regex(/^https:\/\//i),
  evidence: indicatorEvidenceSchema.extend({
    snapshot_path: z.string().regex(/^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.png$/),
    pdf_path: z.string().regex(/^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.pdf$/).optional(),
    captured_at: isoDatetime(),
  }),
});

export const narrativeDraftSchema = z.object({
  context: z.string().trim().min(1).max(1200),
  actions: z.array(sourcedActionSchema).max(5),
});

export const indicatorSchema = z.object({
  key: z.string().regex(INDICATOR_KEY_PATTERN).optional(),
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
  scales_tried: z.array(geographicScaleSchema).max(R.scales),
  searched_at: z.string(),
});

export const dimensionDataSchema = z.object({
  name: z.string(),
  icon: z.string(),
  description: z.string(),
  context: z.string(),
  indicators: z.array(indicatorSchema).max(R.indicatorsPerDimension),
  gaps: z.array(dimensionGapSchema).max(R.gapsPerDimension).optional(),
  actions: z.array(z.string()).max(R.actionsPerDimension),
  action_sources: z.array(sourcedActionSchema).max(R.actionsPerDimension).optional(),
  policy_spotlight: z.string().optional(),
  justice_spotlight: z.string().optional(),
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
  source_url: z.string().refine(isParseableUrl, INVALID_URL),
  source_tier: z.number().int().min(1),
  evidence: indicatorEvidenceSchema,
  confidence: confidenceSchema,
  geographic_scale: geographicScaleSchema,
  notes: z.string().optional(),
  narrative_draft: narrativeDraftSchema.optional(),
});

// Public previews may expose a measured value without inventing a safe target.
// Deliberately excluded from findingPayloadSchema and the approval/DB pipeline.
export const previewObservationSchema = indicatorFindingPayloadSchema.extend({
  kind: z.literal('observation'),
  value: z.number().finite(),
  target: z.null(),
  level_pct: z.null(),
  scoring: z.null(),
  unscored_reason: z.string().min(1),
}).strict();

export const gapFindingPayloadSchema = z.object({
  kind: z.literal('gap'),
  indicator_slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  reason: z.string().min(1),
  scales_tried: z.array(geographicScaleSchema).min(1),
  tiers_tried: z.array(z.number().int().min(1)).optional(),
  searched_at: z.string(),
  nearest_data: z.string().optional(),
});

/**
 * A stand-in measure for an indicator with no acceptable data: a sourced
 * indicator in every field, plus the slug of the indicator it replaces and
 * why it is a fair substitute. Always low confidence; no narrative draft.
 * It stands in for some other indicator, never for itself.
 */
export const proxyFindingPayloadSchema = indicatorFindingPayloadSchema
  .omit({ narrative_draft: true })
  .extend({
    kind: z.literal('proxy'),
    proxy_for: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    rationale: z.string().trim().min(1),
    confidence: z.literal('low'),
  })
  .refine((p) => p.proxy_for !== p.indicator_slug, {
    message: 'A stand-in must name a different indicator than its own',
    path: ['proxy_for'],
  });

/**
 * What a research session returns, and what the public preview build reads
 * from a campaign: an indicator or a gap (the root of finding.schema.json).
 * Never a stand-in, so nothing that parses with this can publish one.
 */
export const findingPayloadSchema = z.discriminatedUnion('kind', [
  indicatorFindingPayloadSchema,
  gapFindingPayloadSchema,
]);

/**
 * Every kind a stored finding may hold: an indicator, a gap, or a stand-in.
 * Only the pass that proposes stand-ins parses with this.
 */
export const storedFindingPayloadSchema = z.discriminatedUnion('kind', [
  indicatorFindingPayloadSchema,
  gapFindingPayloadSchema,
  proxyFindingPayloadSchema,
]);

// ---- Tenant config (SPEC.md §6; portrait keys mirror portrait-config.schema.json) ----

export const sourceTierSchema = z.object({
  tier: z.number().int().min(1),
  name: z.string(),
  description: z.string(),
  examples: z.array(z.string()).max(R.tierExamples).optional(),
});

export const regionConfigSchema = z.object({
  name: z.string().min(1),
  definition: z.string().min(1),
  context_notes: z.string().optional(),
});

export const sourcePriorityConfigSchema = z.object({
  tiers: z.array(sourceTierSchema).min(1).max(R.sourceTiers),
});

export const recencyConfigSchema = z.object({
  default_max_age_years: z.number().int().min(1),
  per_dimension: boundedRecord(z.string(), z.number().int().min(1), R.dimensions).optional(),
});

export const scalePolicyConfigSchema = z.object({
  default_accepted: z.array(geographicScaleSchema).min(1).max(R.scales),
  per_dimension: boundedRecord(z.string(), z.array(geographicScaleSchema).min(1).max(R.scales), R.dimensions).optional(),
});

export const thresholdOverrideSchema = z.object({
  target: z.number(),
  scale: z.number().positive().optional(),
  function: mappingFunctionSchema.optional(),
  low: z.number().optional(),
  high: z.number().optional(),
  rationale: z.string().min(1),
  target_year: z.number().int().min(1900).max(2200).optional(),
});

export const thresholdOverridesConfigSchema = boundedRecord(z.string(), thresholdOverrideSchema, R.thresholdOverrides);

export const reviewPolicyConfigSchema = z.object({
  require_approval: z.enum(['all', 'none']),
  dual_review_on_edits: z.boolean(),
  audit_apply: z.enum(['per_card', 'bulk']).default('per_card'),
  first_post_requires_approval: z.boolean(),
});

export const retentionConfigSchema = z.object({
  transcript_days: z.number().int().min(1),
});

export const notificationConfigSchema = z.object({
  email_on_run_complete: z.boolean(),
  email_on_flagged_finding: z.boolean(),
});

/**
 * Per-portrait feature settings (SPEC-v7 §3): any subset of the registry's
 * portrait features (features.ts), booleans only; unknown keys are refused so
 * a typo cannot silently create a flag nothing reads.
 */
export const featuresConfigSchema = z
  .object({
    emergency: z.boolean(),
    policy_analysis: z.boolean(),
    involvement: z.boolean(),
    discussion: z.boolean(),
    translation: z.boolean(),
    family_compare: z.boolean(),
    request_research: z.boolean(),
    custom_pages: z.boolean(),
    ask_portrait: z.boolean(),
  })
  .partial()
  .strict();

export const progressConfigSchema = z.object({
  baseline_year: z.number().int().min(1900).max(2200).nullable(),
  baseline_label: z.string().min(1).max(120),
});

export const researchModeSchema = z.enum(['right_first', 'right_first_then_fill']);

/**
 * The mode of a portrait with no stored `research_mode`: one made before the
 * setting existed keeps researching as it always has, with no stand-ins,
 * until its group turns them on. A new portrait is given its mode when it is
 * made (defaultTenantConfig), so this applies only to older ones.
 */
export const RESEARCH_MODE_WHEN_UNSET = 'right_first' as const satisfies z.infer<typeof researchModeSchema>;

/**
 * A portrait's research mode from its stored setting (null or undefined when
 * the row does not exist). A value that is not a known mode reads as unset,
 * so a damaged row can never start a stand-in pass.
 */
export function researchModeOf(stored: unknown): z.infer<typeof researchModeSchema> {
  const parsed = researchModeSchema.safeParse(stored);
  return parsed.success ? parsed.data : RESEARCH_MODE_WHEN_UNSET;
}

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
  features: featuresConfigSchema,
  progress: progressConfigSchema,
  research_mode: researchModeSchema,
} as const;
