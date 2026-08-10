import type {
  GeographicScale,
  MappingFunctionName,
  PortraitConfig,
  SourceTier,
  Threshold,
} from '@deep-fryer/contract';

export type Ring = 'social' | 'ecological';
export type Confidence = 'high' | 'medium' | 'low';
export type Role = 'owner' | 'editor' | 'viewer' | 'moderator';
export type ResearchSessionKind = 'region_context' | 'dimension';
export type ContentSupported = 'pass' | 'fail' | 'uncertain';

export type { GeographicScale, MappingFunctionName, PortraitConfig, SourceTier, Threshold };

/** Show-your-work scoring record: the thresholds engine fills this in. */
export interface IndicatorScoring {
  threshold_ref: string;
  function: MappingFunctionName;
  inputs: Record<string, number>;
  worked_math: string;
}

/** Evidence snapshot captured at retrieval time (SPEC.md §8). */
export interface IndicatorEvidence {
  snapshot_path: string;
  pdf_path?: string;
  captured_at: string;
  /** The exact passage containing the figure, copied verbatim from the source. */
  quote?: string;
}

export interface Indicator {
  name: string;
  value: number | string | null;
  unit: string;
  year: number | null;
  target: number | string | null;
  level_pct?: number;
  scoring?: IndicatorScoring;
  source: string;
  source_url: string;
  source_tier?: number;
  evidence?: IndicatorEvidence;
  confidence: Confidence;
  geographic_scale: GeographicScale;
  supporting_source_url?: string;
}

/** Data gaps are first-class findings, not errors (SPEC.md §8). */
export interface DimensionGap {
  indicator: string;
  reason: string;
  scales_tried: GeographicScale[];
  searched_at: string;
}

export interface DimensionData {
  name: string;
  icon: string;
  description: string;
  context: string;
  indicators: Indicator[];
  gaps?: DimensionGap[];
  actions: string[];
  policy_spotlight?: string;
  justice_spotlight?: string;
}

export interface OutreachContactData {
  org: string;
  person?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  tags: string[];
  data_needs: string[];
  why?: string;
  draft_message?: string;
}

export interface TenantBranding {
  logo_url?: string;
  primary_color?: string;
  font?: string;
  footer_html?: string;
}

// ---- Behavior config layer (SPEC.md §6) ----

export interface ReviewPolicyConfig {
  /** 'all' = everything human-gated (default); 'none' reserved for internal dogfooding. */
  require_approval: 'all' | 'none';
  dual_review_on_edits: boolean;
  first_post_requires_approval: boolean;
}

export interface RetentionConfig {
  transcript_days: number;
}

/** Per-tenant feature flags (SPEC §6 behavior layer). */
export interface FeaturesConfig {
  /** Editors may request additional research runs from the public insights surface. */
  request_research: boolean;
}

export interface NotificationConfig {
  email_on_run_complete: boolean;
  email_on_flagged_finding: boolean;
}

/** All tenant_config keys with their value types. */
export interface TenantConfigMap {
  region: PortraitConfig['region'];
  source_priority: PortraitConfig['source_priority'];
  recency: PortraitConfig['recency'];
  scale_policy: PortraitConfig['scale_policy'];
  threshold_overrides: NonNullable<PortraitConfig['threshold_overrides']>;
  review_policy: ReviewPolicyConfig;
  retention: RetentionConfig;
  notifications: NotificationConfig;
  features: FeaturesConfig;
}

export type TenantConfigKey = keyof TenantConfigMap;

// ---- Research plane types (SPEC.md §7–8) ----

export interface FindingVerification {
  url_ok: boolean;
  schema_ok: boolean;
  recency_ok: boolean;
  scale_ok: boolean;
  content_supported: ContentSupported;
  verifier_note?: string;
  /**
   * Does evidence.quote appear in the text archived at capture time
   * (verify-against-the-archived-exhibit)? Absent when the finding carries
   * no quote or the source yielded no text — unknowable ≠ failed.
   */
  quote_ok?: boolean;
}

export interface IndicatorFindingPayload {
  kind: 'indicator';
  indicator_slug: string;
  name: string;
  value: number | string;
  unit: string;
  year: number;
  target: number | string;
  level_pct: number;
  scoring: IndicatorScoring;
  source: string;
  source_url: string;
  source_tier: number;
  evidence: IndicatorEvidence;
  confidence: Confidence;
  geographic_scale: GeographicScale;
  notes?: string;
}

export interface GapFindingPayload {
  kind: 'gap';
  indicator_slug: string;
  reason: string;
  scales_tried: GeographicScale[];
  tiers_tried?: number[];
  searched_at: string;
  nearest_data?: string;
}

export type FindingPayload = IndicatorFindingPayload | GapFindingPayload;

/** One rendered session spec inside a research plan — inspectable before spend. */
export interface PlannedSession {
  kind: ResearchSessionKind;
  dimension_slug?: string;
  prompt: string;
  tool_allowlist: string[];
  output_schema_ref: string;
  config_hash: string;
}

export interface ResearchPlan {
  sessions: PlannedSession[];
  config_hash: string;
  plugin_version: string;
}

export interface SessionTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

export type RunTokenUsage = Record<string, SessionTokenUsage>;

// ---- Verification admin mode (SPEC.md §9): reviewer notes & dispositions ----

/** A reviewer's verdict on one finding. Append-only; latest row wins. */
export type DispositionState = 'verified' | 'rejected' | 'needs_rework';

/**
 * Controlled vocabulary for machine-readable review reasons. Labels and
 * descriptions live as data in @deep-fryer/contract (review-reasons.json);
 * this union is the type-level mirror and the two are guard-tested together.
 */
export type ReviewReasonCode =
  | 'wrong_value'
  | 'wrong_source'
  | 'outdated'
  | 'wrong_scale'
  | 'misread_source'
  | 'better_source_exists'
  | 'methodology_issue'
  | 'gap_confirmed'
  | 'other';

/**
 * The structured half of a reviewer note — everything a machine consumer
 * (re-research prompts, the verify gate, quality rollups) can act on without
 * parsing prose. Free-form thoughts ride alongside in the note text column,
 * never inside this object.
 */
export interface ReviewAnnotation {
  reason_code?: ReviewReasonCode;
  suggested_source_url?: string;
  suggested_value?: number | string;
  suggested_unit?: string;
  suggested_year?: number;
  tags?: string[];
}
