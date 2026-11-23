import findingSchema from '@deep-fryer/contract/schemas/finding' with { type: 'json' };
import type { PortraitConfig } from '@deep-fryer/contract';
import {
  acceptedScales,
  maxDataAgeYears,
  type ContentSupported,
  type FindingPayload,
} from '@deep-fryer/core';

/** Why the hybrid strategy selected an indicator for Opus deep-discovery escalation. */
export type EscalationReason = 'gap' | 'verification_failed';

export interface EvaluatedFindingSnapshot {
  indicatorSlug: string;
  payload: FindingPayload | null;
  verdict: { content_supported: ContentSupported; verifier_note?: string } | null;
}

export interface EscalationCandidate {
  indicatorSlug: string;
  reason: EscalationReason;
  initial: EvaluatedFindingSnapshot;
}

/**
 * Pure: select ONLY indicators that ended in a `gap` or failed independent
 * verification (`content_supported === 'fail'`) after the initial pass.
 * Indicators that already passed verification (or are `uncertain`) stay untouched
 * so hybrid runs spend Opus deep-discovery tokens strictly where Sonnet failed
 * or could not locate a compliant source.
 */
export function selectEscalationCandidates(
  evaluated: readonly EvaluatedFindingSnapshot[],
): EscalationCandidate[] {
  const candidates: EscalationCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of evaluated) {
    if (!entry.indicatorSlug || entry.indicatorSlug === 'unknown' || seen.has(entry.indicatorSlug)) continue;
    if (entry.payload?.kind === 'gap') {
      seen.add(entry.indicatorSlug);
      candidates.push({ indicatorSlug: entry.indicatorSlug, reason: 'gap', initial: entry });
    } else if (entry.verdict?.content_supported === 'fail') {
      seen.add(entry.indicatorSlug);
      candidates.push({ indicatorSlug: entry.indicatorSlug, reason: 'verification_failed', initial: entry });
    }
  }
  return candidates;
}

/**
 * Pure: render the targeted Opus deep-discovery prompt for the indicators
 * selected by `selectEscalationCandidates`. Summarizes the dead ends or
 * verification failures from the initial Sonnet pass so Opus + Sonnet scouts
 * search deeper (tier-2/tier-3 releases, regional datasets, downloadable tables
 * and PDFs) without repeating already-passed indicators.
 */
export function renderHybridEscalationPrompt(input: {
  config: PortraitConfig;
  dimensionSlug: string;
  dimensionName: string;
  regionBrief: string;
  candidates: readonly EscalationCandidate[];
}): string {
  const maxAge = maxDataAgeYears(input.config.recency, input.dimensionSlug);
  const scales = acceptedScales(input.config.scale_policy, input.dimensionSlug);
  const tiersBlock = input.config.source_priority.tiers
    .map(
      (t) =>
        `- Tier ${t.tier} — ${t.name}: ${t.description}${
          t.examples?.length ? ` (e.g. ${t.examples.join(', ')})` : ''
        }`,
    )
    .join('\n');

  const items = input.candidates
    .map((candidate, idx) => {
      const { initial, reason, indicatorSlug } = candidate;
      if (reason === 'gap' && initial.payload?.kind === 'gap') {
        const g = initial.payload;
        return [
          `${idx + 1}. Indicator slug: ${indicatorSlug} (escalated because initial pass returned a GAP)`,
          `   - Initial gap reason: ${g.reason}`,
          `   - Scales tried: ${g.scales_tried.join(', ') || 'none recorded'}`,
          ...(g.tiers_tried?.length ? [`   - Tiers tried: ${g.tiers_tried.join(', ')}`] : []),
          ...(g.nearest_data ? [`   - Nearest rejected data: ${g.nearest_data}`] : []),
        ].join('\n');
      }
      if (initial.payload?.kind === 'indicator') {
        const p = initial.payload;
        return [
          `${idx + 1}. Indicator: ${p.name} (slug: ${indicatorSlug}, unit: ${p.unit}) (escalated because initial finding FAILED independent verification)`,
          `   - Rejected claim: ${p.value} ${p.unit} (${p.year}, ${p.geographic_scale} scale) from ${p.source} (${p.source_url})`,
          `   - Threshold / scoring ref: ${p.scoring.threshold_ref} (${p.scoring.function}, target: ${p.target})`,
          `   - Verifier note: ${initial.verdict?.verifier_note ?? 'content was not supported by the cited source'}`,
        ].join('\n');
      }
      return [
        `${idx + 1}. Indicator slug: ${indicatorSlug} (escalated because initial output failed schema/verification)`,
        `   - Note: ${initial.verdict?.verifier_note ?? 'output did not conform to finding schema'}`,
      ].join('\n');
    })
    .join('\n\n');

  return `# Hybrid escalation — deep discovery pass

You are running the selective Opus escalation pass for **${input.dimensionName}** (${input.config.region.name}). The initial pass already succeeded on other indicators — research ONLY the escalated indicator(s) listed below.

## Region brief

${input.regionBrief}

## Escalated indicators (research ONLY these)

${items}

## Binding portrait rules

Source priority (exhaust tier N before accepting tier N+1; if tier 1 has nothing, search lower tiers thoroughly including state/regional agencies and peer-reviewed science when permitted):
${tiersBlock}

- Recency: data must be from the last ${maxAge} years. Older data is a data gap.
- Accepted geographic scales (in preference order): ${scales.join(' → ')}. A compliant value at an accepted wider scale (e.g. regional) honestly labeled with that \`geographic_scale\` is valid.

## Evidence and honesty rules

- For every accepted source, cite the concrete page, table, or direct PDF URL (never a home or section page) and call \`capture_evidence\` (with \`pdf_url\` for PDFs) so the archived snapshot and readable text directly show the figure.
- If no compliant source exists across all tiers and accepted scales, emit an honest \`kind: "gap"\` finding with full \`scales_tried\`, \`tiers_tried\`, and \`nearest_data\`. Never fabricate or guess a value.

## Output

Return ONLY a JSON array containing one finding object per escalated indicator listed above (in order, matching the exact \`indicator_slug\`), conforming to this schema:

\`\`\`json
${JSON.stringify(findingSchema, null, 1)}
\`\`\`

No prose before or after the JSON array.`;
}

/**
 * Pure: whether an escalated finding from the Opus deep-discovery pass should
 * replace the initial finding.
 * - Schema-invalid escalation output never replaces the initial finding.
 * - An honest gap is NEVER replaced by a verification-failed fabrication; it
 *   IS replaced by a verified (`pass`) or `uncertain` sourced indicator, or a
 *   more detailed gap.
 * - A verification-failed finding IS replaced by a verified (`pass`) or
 *   `uncertain` sourced indicator, OR by an honest `gap` (gaps outrank guesses).
 */
export function shouldAcceptEscalation(
  initial: EvaluatedFindingSnapshot,
  escalated: EvaluatedFindingSnapshot,
): boolean {
  if (!escalated.payload) return false;

  const escalatedStatus = escalated.verdict?.content_supported ?? 'uncertain';
  if (initial.payload?.kind === 'gap') {
    if (escalated.payload.kind === 'indicator') {
      return escalatedStatus === 'pass' || escalatedStatus === 'uncertain';
    }
    if (escalated.payload.kind === 'gap') {
      return Boolean(escalated.payload.nearest_data) && !initial.payload.nearest_data;
    }
    return false;
  }

  // Initial finding failed verification (or schema).
  if (escalated.payload.kind === 'gap') return true;
  if (escalated.payload.kind === 'indicator') {
    return escalatedStatus === 'pass' || escalatedStatus === 'uncertain';
  }
  return false;
}
