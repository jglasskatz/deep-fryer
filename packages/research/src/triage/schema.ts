import { z } from 'zod';
import type { GeographicScale } from '@deep-fryer/core';

/**
 * Lightweight frame/construct triage contract (SPEC-JEV §1, §4, §5).
 *
 * Strictly advisory and flag-expanding: triage may surface warnings and rank
 * review cards worst-first, but can NEVER auto-approve a finding or suppress
 * an independent verifier / deterministic check flag.
 */

export const CONSTRUCT_MATCH_VALUES = ['match', 'partial', 'mismatch', 'unclear'] as const;
export type ConstructMatch = (typeof CONSTRUCT_MATCH_VALUES)[number];

export const EPISTEMIC_TYPE_VALUES = [
  'measured',
  'projection_or_goal',
  'modeled_estimate',
  'unclear',
] as const;
export type EpistemicType = (typeof EPISTEMIC_TYPE_VALUES)[number];

export const GEOGRAPHY_MATCH_VALUES = ['match', 'broader_proxy', 'mismatch', 'unclear'] as const;
export type GeographyMatch = (typeof GEOGRAPHY_MATCH_VALUES)[number];

export const PRIMARY_SOURCE_VALUES = ['primary', 'secondary_republisher', 'unclear'] as const;
export type PrimarySourceStatus = (typeof PRIMARY_SOURCE_VALUES)[number];

export const TRIAGE_SEVERITY_VALUES = ['high', 'medium', 'low', 'none'] as const;
export type TriageSeverity = (typeof TRIAGE_SEVERITY_VALUES)[number];

export const TRIAGE_REASON_MAX_CHARS = 240;

export const triageAssessmentSchema = z
  .object({
    construct_match: z.enum(CONSTRUCT_MATCH_VALUES),
    epistemic_type: z.enum(EPISTEMIC_TYPE_VALUES),
    geography_match: z.enum(GEOGRAPHY_MATCH_VALUES),
    is_primary_source: z.enum(PRIMARY_SOURCE_VALUES),
    reason: z.string().trim().min(1).max(TRIAGE_REASON_MAX_CHARS),
  })
  .strict();

export type TriageAssessment = z.infer<typeof triageAssessmentSchema>;

/** Plain JSON Schema mirror of `triageAssessmentSchema` for structured-output prompts/APIs. */
export const TRIAGE_ASSESSMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['construct_match', 'epistemic_type', 'geography_match', 'is_primary_source', 'reason'],
  properties: {
    construct_match: { type: 'string', enum: [...CONSTRUCT_MATCH_VALUES] },
    epistemic_type: { type: 'string', enum: [...EPISTEMIC_TYPE_VALUES] },
    geography_match: { type: 'string', enum: [...GEOGRAPHY_MATCH_VALUES] },
    is_primary_source: { type: 'string', enum: [...PRIMARY_SOURCE_VALUES] },
    reason: { type: 'string', minLength: 1, maxLength: TRIAGE_REASON_MAX_CHARS },
  },
} as const;

export const TRIAGE_FLAG_VALUES = [
  'wrong_construct',
  'partial_construct',
  'not_a_measurement',
  'modeled_estimate',
  'wrong_geography',
  'broader_geography_proxy',
  'tier_overclaimed',
  'secondary_republisher',
  'unclear_evidence',
] as const;
export type TriageFlag = (typeof TRIAGE_FLAG_VALUES)[number];

export interface TriageContext {
  /** Finding's self-reported source tier (1 = primary official authority). */
  claimedSourceTier?: number;
  /** Finding's self-reported geographic scale. */
  claimedScale?: GeographicScale;
  /** Portrait's native local geographic scale (e.g. 'city' or 'county'). */
  portraitScale?: GeographicScale;
}

const SCALE_ORDER: Readonly<Record<GeographicScale, number>> = {
  city: 0,
  county: 1,
  regional: 2,
  state: 3,
  national: 4,
  global: 5,
};

/**
 * True when the finding honestly declares a broader geographic scale than the
 * portrait's native scale (SPEC-JEV §5.2 carve-out: e.g., a citywide figure
 * honestly labeled `city` or `regional` under scale policy).
 */
function isHonestlyLabeledBroaderScale(context?: TriageContext): boolean {
  if (!context?.claimedScale || !context.portraitScale) return false;
  return SCALE_ORDER[context.claimedScale] > SCALE_ORDER[context.portraitScale];
}

function unclearCount(a: TriageAssessment): number {
  let count = 0;
  if (a.construct_match === 'unclear') count++;
  if (a.epistemic_type === 'unclear') count++;
  if (a.geography_match === 'unclear') count++;
  if (a.is_primary_source === 'unclear') count++;
  return count;
}

/**
 * Deterministic advisory flags derived from a `TriageAssessment`.
 * Independent rules — a single severe defect cannot be averaged away.
 */
export function triageFlags(assessment: TriageAssessment, context?: TriageContext): TriageFlag[] {
  const flags: TriageFlag[] = [];

  if (assessment.construct_match === 'mismatch') flags.push('wrong_construct');
  else if (assessment.construct_match === 'partial') flags.push('partial_construct');

  if (assessment.epistemic_type === 'projection_or_goal') flags.push('not_a_measurement');
  else if (assessment.epistemic_type === 'modeled_estimate') flags.push('modeled_estimate');

  if (assessment.geography_match === 'mismatch') {
    flags.push('wrong_geography');
  } else if (assessment.geography_match === 'broader_proxy' && !isHonestlyLabeledBroaderScale(context)) {
    flags.push('broader_geography_proxy');
  }

  if (assessment.is_primary_source === 'secondary_republisher') {
    if (context?.claimedSourceTier === 1) flags.push('tier_overclaimed');
    else flags.push('secondary_republisher');
  }

  if (unclearCount(assessment) >= 2) {
    flags.push('unclear_evidence');
  }

  return flags;
}

/**
 * Deterministic severity classification over a `TriageAssessment`:
 * - `'high'`: wrong construct, projection/goal quoted as measurement, or wrong geography.
 * - `'medium'`: partial construct match, unlabeled broader-geography proxy, tier-1 claimed on a secondary republisher, or ≥ 2 unclear dimensions.
 * - `'low'`: modeled estimate, secondary republisher on non-tier-1 claim, honestly labeled broader proxy, or 1 unclear dimension.
 * - `'none'`: all four orthogonal checks clean.
 */
export function triageSeverity(assessment: TriageAssessment, context?: TriageContext): TriageSeverity {
  if (
    assessment.construct_match === 'mismatch' ||
    assessment.epistemic_type === 'projection_or_goal' ||
    assessment.geography_match === 'mismatch'
  ) {
    return 'high';
  }

  const unclear = unclearCount(assessment);
  const unlabeledBroader =
    assessment.geography_match === 'broader_proxy' && !isHonestlyLabeledBroaderScale(context);
  const tier1Republisher =
    assessment.is_primary_source === 'secondary_republisher' && context?.claimedSourceTier === 1;

  if (
    assessment.construct_match === 'partial' ||
    unlabeledBroader ||
    tier1Republisher ||
    unclear >= 2
  ) {
    return 'medium';
  }

  if (
    assessment.epistemic_type === 'modeled_estimate' ||
    assessment.is_primary_source === 'secondary_republisher' ||
    assessment.geography_match === 'broader_proxy' ||
    unclear === 1
  ) {
    return 'low';
  }

  return 'none';
}

export const TRIAGE_SEVERITY_RANK: Readonly<Record<TriageSeverity, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Numeric urgency score for deterministic ordering within the review queue
 * (higher = worse / reviewed first). Never a pass/fail gate.
 */
export function triagePriorityScore(
  assessment: TriageAssessment | null | undefined,
  context?: TriageContext,
): number {
  if (!assessment) return 0;
  let score = 0;

  if (assessment.construct_match === 'mismatch') score += 40;
  else if (assessment.construct_match === 'partial') score += 16;
  else if (assessment.construct_match === 'unclear') score += 6;

  if (assessment.epistemic_type === 'projection_or_goal') score += 40;
  else if (assessment.epistemic_type === 'modeled_estimate') score += 8;
  else if (assessment.epistemic_type === 'unclear') score += 6;

  if (assessment.geography_match === 'mismatch') score += 40;
  else if (assessment.geography_match === 'broader_proxy') {
    score += isHonestlyLabeledBroaderScale(context) ? 4 : 18;
  } else if (assessment.geography_match === 'unclear') score += 6;

  if (assessment.is_primary_source === 'secondary_republisher') {
    score += context?.claimedSourceTier === 1 ? 20 : 8;
  } else if (assessment.is_primary_source === 'unclear') score += 5;

  return score;
}

/**
 * Strictly flag-expanding invariant (SPEC-JEV §1, §2):
 * Triage can add an advisory flag (`high` or `medium` severity), and can NEVER
 * suppress an existing deterministic or verifier flag.
 */
export function triageExpandsFlagged(
  existingFlagged: boolean,
  assessment: TriageAssessment | null | undefined,
  context?: TriageContext,
): boolean {
  if (existingFlagged) return true;
  if (!assessment) return false;
  const sev = triageSeverity(assessment, context);
  return sev === 'high' || sev === 'medium';
}
