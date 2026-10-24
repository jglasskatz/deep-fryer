import { createHash } from 'node:crypto';
import findingSchema from '@deep-fryer/contract/schemas/finding' with { type: 'json' };
import type { FrameworkIndicator, PortraitConfig } from '@deep-fryer/contract';
import {
  acceptedScales,
  maxDataAgeYears,
  resolveThreshold,
  dimensionResearchSessions,
  MAX_INDICATORS_PER_RESEARCH_SESSION,
  type ResearchModels,
  type ResearchStrategy,
  type ResearchPlan,
  type Ring,
} from '@deep-fryer/core';
import { agentTemplate, fillTemplate, pluginVersion, skill } from './plugin.js';

export interface PlanDimensionSpec {
  dimensionId: string;
  slug: string;
  ring: Ring;
  name: string;
  indicators: FrameworkIndicator[];
  reviewerNotes?: string;
}

export interface RenderPlanInput {
  config: PortraitConfig;
  dimensions: PlanDimensionSpec[];
  strategy?: ResearchStrategy;
  /** Operator defaults, frozen into a new plan when no preset is selected. */
  modelDefaults?: Partial<ResearchModels>;
}

export const REGION_BRIEF_PLACEHOLDER = '{{region_brief}}';

// Session execution policy (SPEC.md §8): tool allowlists and budgets are
// research-plane policy, named here so the rendered plan and the worker
// cannot disagree about what runs.
const DIMENSION_TOOLS = ['WebSearch', 'WebFetch', 'mcp__evidence__capture_evidence'];
const REGION_TOOLS = ['WebSearch', 'WebFetch'];
export const VERIFIER_TOOLS = ['WebFetch', 'Read'];
/** Keep research contexts small; the worker still records each chunk independently. */
export const MAX_INDICATORS_PER_SESSION = MAX_INDICATORS_PER_RESEARCH_SESSION;
export const DEFAULT_SESSION_MAX_TURNS = 60;
export const VERIFIER_MAX_TURNS = 12;
export const DEFAULT_SESSION_MODEL = 'claude-sonnet-5';
export const DEFAULT_VERIFIER_MODEL = 'claude-opus-5';

/** Presets are inspectable run configuration, never a mutable worker toggle. */
export function researchModels(strategy?: ResearchStrategy, defaults: Partial<ResearchModels> = {}): ResearchModels {
  if (strategy === 'deep') return { session_model: DEFAULT_VERIFIER_MODEL, subagent_model: DEFAULT_SESSION_MODEL, verifier_model: DEFAULT_VERIFIER_MODEL };
  if (strategy === 'standard') return { session_model: DEFAULT_SESSION_MODEL, subagent_model: null, verifier_model: DEFAULT_VERIFIER_MODEL };
  return {
    session_model: defaults.session_model || DEFAULT_SESSION_MODEL,
    subagent_model: defaults.subagent_model || null,
    verifier_model: defaults.verifier_model || DEFAULT_VERIFIER_MODEL,
  };
}

function renderTiers(config: PortraitConfig): string {
  return config.source_priority.tiers
    .map(
      (t) =>
        `- Tier ${t.tier} — ${t.name}: ${t.description}${
          t.examples?.length ? ` (e.g. ${t.examples.join(', ')})` : ''
        }`,
    )
    .join('\n');
}

function renderThresholds(spec: PlanDimensionSpec, config: PortraitConfig): string {
  return spec.indicators
    .map((ind) => {
      const t = resolveThreshold(ind.threshold_ref, config.threshold_overrides);
      if (!t) return `- ${ind.name} (${ind.slug}): no framework threshold — report the value; scoring happens in review.`;
      const params =
        t.function === 'band'
          ? `band [${t.low}, ${t.high}]`
          : `target ${t.target}${t.scale ? `, scale ${t.scale}` : ''}`;
      return `- ${ind.name} (ref: ${ind.threshold_ref}): ${t.function}, ${params}. Rationale: ${t.rationale}`;
    })
    .join('\n');
}

/**
 * Render a run's full session list without spending tokens (SPEC.md §8
 * Plan): every prompt is final except {{region_brief}}, which the worker
 * substitutes once the phase-0 session has produced it.
 */
export function renderPlan(input: RenderPlanInput): ResearchPlan {
  const { config } = input;
  const configHash = createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .slice(0, 16);

  const skillsBlock = [skill('methodology'), skill('source-evaluation'), skill('evidence-capture')].join(
    '\n\n---\n\n',
  );

  const regionPrompt = fillTemplate(agentTemplate('region-context'), {
    region_name: config.region.name,
    region_definition: config.region.definition,
    region_context_notes: config.region.context_notes ?? '(none provided)',
  });

  const sessions: ResearchPlan['sessions'] = [
    {
      kind: 'region_context',
      prompt: regionPrompt,
      tool_allowlist: REGION_TOOLS,
      output_schema_ref: 'markdown:region-brief',
      config_hash: configHash,
    },
  ];

  const researcherTemplate = agentTemplate('dimension-researcher');
  for (const dimension of input.dimensions) {
    // Preserve the one-session behavior for sparse/custom dimensions without
    // indicators. Every indicator appears in exactly one bounded chunk.
    const chunks = dimension.indicators.length
      ? Array.from({ length: dimensionResearchSessions(dimension.indicators.length) }, (_, index) =>
          dimension.indicators.slice(index * MAX_INDICATORS_PER_SESSION, (index + 1) * MAX_INDICATORS_PER_SESSION))
      : [[]];
    for (const [index, indicators] of chunks.entries()) {
      const spec = { ...dimension, indicators };
      const maxAge = maxDataAgeYears(config.recency, spec.slug);
      const scales = acceptedScales(config.scale_policy, spec.slug);

      const prompt =
        `${skillsBlock}\n\n---\n\n` +
        (chunks.length > 1
          ? `This is part ${index + 1} of ${chunks.length} for this dimension. Research ONLY the indicators listed in this part; other parts have separate sessions.\n\n`
          : '') +
        fillTemplate(researcherTemplate, {
          region_brief: REGION_BRIEF_PLACEHOLDER,
          dimension_name: spec.name,
          dimension_ring: spec.ring === 'social' ? 'social foundation' : 'ecological ceiling',
          indicator_list: spec.indicators
            .map((i) => `  - ${i.name} (slug: ${i.slug}, unit: ${i.unit})`)
            .join('\n'),
          reviewer_notes: spec.reviewerNotes?.trim() || '(none — first research pass)',
          source_priority_tiers: renderTiers(config),
          max_age_years: String(maxAge),
          accepted_scales: scales.join(' → '),
          thresholds_block: renderThresholds(spec, config),
          // The session has no filesystem access to the contract package, so the
          // schema must travel in the prompt — a named reference alone leaves the
          // model to guess field names, and every guess fails the schema gate.
          finding_schema: JSON.stringify(findingSchema, null, 1),
        });

      sessions.push({
        kind: 'dimension',
        dimension_slug: spec.slug,
        prompt,
        tool_allowlist: DIMENSION_TOOLS,
        output_schema_ref: 'contract:finding.schema.json',
        config_hash: configHash,
      });
    }
  }

  return {
    sessions, config_hash: configHash, plugin_version: pluginVersion(),
    ...(input.strategy ? { strategy: input.strategy } : {}),
    models: researchModels(input.strategy, input.modelDefaults),
  };
}

export function renderVerifierPrompt(input: {
  indicator_name: string;
  claimed_value: string;
  unit: string;
  year: string;
  geography: string;
  source_name: string;
  source_url: string;
  /** Local filenames supplied by the worker, never paths proposed by a model. */
  archived_exhibits?: string[];
  archive_note?: string;
  narrative_draft?: unknown;
}): string {
  return fillTemplate(agentTemplate('verifier'), {
    indicator_name: input.indicator_name,
    claimed_value: input.claimed_value,
    unit: input.unit,
    year: input.year,
    geography: input.geography,
    source_name: input.source_name,
    source_url: input.source_url,
    archived_exhibits: input.archived_exhibits?.length
      ? input.archived_exhibits.map((name) => `- ${name}`).join('\n')
      : '(No archived exhibit could be loaded.)',
    archive_note: input.archive_note ?? '',
    narrative_draft: input.narrative_draft ? JSON.stringify(input.narrative_draft) : '(None proposed.)',
  });
}
