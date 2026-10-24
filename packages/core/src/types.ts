import type { ProgressConfig } from './progress.js';
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
}

export interface SourcedAction {
  text: string;
  source_url: string;
  evidence: IndicatorEvidence;
}

/** Research proposal only; it reaches a version solely by explicit human opt-in. */
export interface NarrativeDraft {
  context: string;
  actions: SourcedAction[];
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
  action_sources?: SourcedAction[];
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
  /** Machine recommendations still require a human action. Defaults to per_card. */
  audit_apply?: 'per_card' | 'bulk';
  first_post_requires_approval: boolean;
}

export interface RetentionConfig {
  transcript_days: number;
}

/**
 * Per-tenant feature flags (SPEC §6 behavior layer; SPEC-v7 §3). Every key is
 * optional: an unset key means the registry default (features.ts), so a
 * portrait's stored config never needs rewriting when a feature is added.
 */
export interface FeaturesConfig {
  custom_pages?: boolean;
  emergency?: boolean;
  policy_analysis?: boolean;
  involvement?: boolean;
  discussion?: boolean;
  translation?: boolean;
  family_compare?: boolean;
  /** Editors may request additional research runs from the public insights surface. */
  request_research?: boolean;
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
  progress: ProgressConfig;
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
  narrative_supported?: ContentSupported;
  /**
   * True when the session's output was malformed JSON and this finding was
   * salvaged from inside it (apps/worker session.ts extractJson): the
   * session may have returned more findings that could not be read, so
   * this one is flagged for review (core isFlagged) rather than passing as
   * if the session had answered cleanly. The session itself is not marked
   * failed — its findings are in review and it was paid for. Absent on
   * findings recorded before the check existed, which reads as false.
   */
  partial_output?: boolean;
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
  narrative_draft?: NarrativeDraft;
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
  /** Optional on historic plans, which retain the worker's env defaults. */
  strategy?: ResearchStrategy;
  models?: ResearchModels;
}

export type ResearchStrategy = 'standard' | 'deep';

/** Frozen at plan time so changing worker defaults cannot change approved spend. */
export interface ResearchModels {
  session_model: string;
  subagent_model: string | null;
  verifier_model: string;
}

/**
 * One model's share of a session's usage, from the Agent SDK result's
 * `modelUsage` (apps/worker session.ts). It covers every API call made on
 * that model — the main loop, subagents, and the CLI's own side calls (the
 * small model that reads each fetched page, the WebSearch side query) —
 * which the session's top-level fields do not. Priced by model-pricing.ts.
 */
export interface ModelTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_search_requests: number;
  /** Tokens from API calls whose prompt (input + cache read + cache write) exceeded 100,000. */
  long_prompt?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };
}

/**
 * A refusal the CLI answered by retrying the turn on another model (the
 * Agent SDK's `model_refusal_fallback` notice). Recorded so that a verdict
 * or a finding produced by a different model than the one configured is
 * visible afterwards — the verifier's judge in particular is meant to be
 * one constant model.
 */
export interface RefusalFallbackEvent {
  original_model: string;
  fallback_model: string;
  /** The refusal category the API reported ('cyber', …), or null when none was given. */
  category: string | null;
}

/**
 * What one session (or a fold of several, see mergeUsage) used. The four
 * token fields are the main loop's own, as recorded since the first run;
 * everything else is optional so rows written before it existed still read
 * — and the admin pages, which sum `input_tokens + output_tokens` over a
 * run's records, never meet a record without them.
 */
export interface SessionTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  /** The session's main model, from the SDK's system init message. */
  model?: string;
  /** Per-model usage, the basis for pricing (model-pricing.ts priceSessionUsage). */
  by_model?: Record<string, ModelTokenUsage>;
  num_turns?: number;
  /** The SDK result's subtype ('success', 'error_max_turns', …). */
  result_subtype?: string;
  /** Why the CLI's loop ended ('completed', 'max_turns', 'model_error', …). */
  terminal_reason?: string;
  stop_reason?: string | null;
  /** API requests that ended in a refusal, whether or not the CLI retried them on another model. */
  refusals?: number;
  /** Refusals the CLI retried on a fallback model, in the order they happened. */
  refusal_fallbacks?: RefusalFallbackEvent[];
  /** The attempt threw before its result: these are streamed totals, and side-call spend is lost. */
  partial?: boolean;
}

export type RunTokenUsage = Record<string, SessionTokenUsage>;
