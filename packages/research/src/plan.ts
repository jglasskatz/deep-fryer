import { createHash } from 'node:crypto';
import findingSchema from '@deep-fryer/contract/schemas/finding' with { type: 'json' };
import type { FrameworkIndicator, PortraitConfig } from '@deep-fryer/contract';
import {
  acceptedScales,
  maxDataAgeYears,
  resolveThreshold,
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
}

export const REGION_BRIEF_PLACEHOLDER = '{{region_brief}}';

// Session execution policy (SPEC.md §8): tool allowlists and budgets are
// research-plane policy, named here so the rendered plan and the worker
// cannot disagree about what runs.
const DIMENSION_TOOLS = ['WebSearch', 'WebFetch', 'mcp__evidence__capture_evidence'];
const REGION_TOOLS = ['WebSearch', 'WebFetch'];
export const VERIFIER_TOOLS = ['WebFetch'];
export const DEFAULT_SESSION_MAX_TURNS = 60;
export const VERIFIER_MAX_TURNS = 12;
export const DEFAULT_SESSION_MODEL = 'claude-sonnet-5';

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
  for (const spec of input.dimensions) {
    const maxAge = maxDataAgeYears(config.recency, spec.slug);
    const scales = acceptedScales(config.scale_policy, spec.slug);

    const prompt =
      `${skillsBlock}\n\n---\n\n` +
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

  return { sessions, config_hash: configHash, plugin_version: pluginVersion() };
}

export function renderVerifierPrompt(input: {
  indicator_name: string;
  claimed_value: string;
  unit: string;
  year: string;
  source_name: string;
  source_url: string;
}): string {
  return fillTemplate(agentTemplate('verifier'), {
    indicator_name: input.indicator_name,
    claimed_value: input.claimed_value,
    unit: input.unit,
    year: input.year,
    source_name: input.source_name,
    source_url: input.source_url,
  });
}
