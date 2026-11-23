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
  /** Storage path of the readable text of the page and its PDF, when there was any. */
  text_path?: string;
  /** Set when the capture found no readable words (a scanned document, an image). */
  no_readable_text?: true;
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
  /**
   * The row's stable key within its dimension (core indicator-keys.ts): a
   * framework indicator's slug, or one derived from a custom indicator's
   * name when first saved. It survives renames, so edits and gaps name the
   * row by it. Absent on versions written before keys existed.
   */
  key?: string;
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
  /** The key of the indicator without data (Indicator.key), or WHOLE_DIMENSION_GAP for every indicator. */
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

/**
 * How a portrait's research treats indicators it could not source:
 * - `right_first`: only solid findings; a missing indicator stays a gap.
 * - `right_first_then_fill`: the same, then a cheaper second pass proposes
 *   labelled stand-in measures for the gaps. A stand-in waits for a person
 *   to accept it; no ordinary approval ever publishes one.
 */
export type ResearchMode = 'right_first' | 'right_first_then_fill';

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
  research_mode: ResearchMode;
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
  /**
   * Whether the claimed value was found, written in one of its usual forms,
   * in the readable text kept with the captured page (packages/research
   * page-text.ts). `no_text` when the capture kept no text to look in.
   * Recorded before the verifier runs; a finding whose value was not found
   * is flagged for review (core isFlagged), and the verifier still judges
   * it. Absent on findings recorded before the check existed, and on gaps.
   */
  value_on_page?: ValueOnPage;
  /**
   * True when the cited link is a publisher's home or section page rather
   * than the page or document holding the figure (core source-links.ts).
   * Such a finding is flagged for review. Absent on findings recorded before
   * the check existed, which reads as false.
   */
  home_page_link?: boolean;
}

/** What the value check found in a captured page's readable text. */
export type ValueOnPage = 'found' | 'not_found' | 'no_text';

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

/**
 * A stand-in: a sourced measure offered in place of an indicator that has
 * no acceptable data (`proxy_for`, that indicator's slug), with the reason
 * it is a fair substitute. It carries every field a sourced indicator does,
 * is always low confidence, and has no narrative draft. It never becomes
 * part of a version through an ordinary approval: a person accepts or
 * rejects each one on its own.
 */
export interface ProxyFindingPayload extends Omit<IndicatorFindingPayload, 'kind' | 'confidence' | 'narrative_draft'> {
  kind: 'proxy';
  proxy_for: string;
  rationale: string;
  confidence: 'low';
}

export type FindingPayload = IndicatorFindingPayload | GapFindingPayload | ProxyFindingPayload;

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
  /**
   * The registry entry the plan was rendered from (packages/research
   * strategies.ts), by name and version. Historic plans carry neither, or a
   * name alone (plans made before strategies had versions); they run on the
   * worker's own defaults for whatever they did not record.
   */
  strategy?: StrategyName;
  strategy_version?: number;
  models?: ResearchModels;
  /** Optional on historic plans, which run on the worker's turn-cap constants. */
  caps?: ResearchCaps;
}

/** The strategies a person can choose when planning a run. */
export const RESEARCH_STRATEGIES = ['standard', 'hybrid', 'deep'] as const;
export type ResearchStrategy = (typeof RESEARCH_STRATEGIES)[number];

/** Every strategy name a plan can record: the choosable ones, and the one a plan with no choice records. */
export type StrategyName = ResearchStrategy | 'operator-defaults';

export function isResearchStrategy(value: unknown): value is ResearchStrategy {
  return typeof value === 'string' && (RESEARCH_STRATEGIES as readonly string[]).includes(value);
}

/** Frozen at plan time so changing worker defaults cannot change approved spend. */
export interface ResearchModels {
  session_model: string;
  subagent_model: string | null;
  verifier_model: string;
  /**
   * The model the CLI reads every fetched page through (its small/fast
   * model). Absent on plans made before it was recorded, which keep the
   * worker's own setting.
   */
  page_reader_model?: string;
  /**
   * Stronger researcher model used for selective escalation on hybrid runs:
   * only indicators that ended in a gap or failed verification after the
   * initial pass are escalated to this model (orchestrating `subagent_model`
   * scouts). Absent on standard, deep, and operator-defaults plans.
   */
  escalation_model?: string | null;
}

/** Turn limits frozen into a plan, so a later change to the worker's constants cannot change a planned run. */
export interface ResearchCaps {
  /** Region-context and dimension research sessions. */
  session_max_turns: number;
  /** One verifier session per indicator finding. */
  verifier_max_turns: number;
  /** One post-run audit session per audited finding. */
  audit_max_turns: number;
  /** Optional bounded turn cap for selective escalation passes (hybrid strategy). */
  escalation_max_turns?: number;
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
