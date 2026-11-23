import findingSchema from '@deep-fryer/contract/schemas/finding' with { type: 'json' };
import type { PortraitConfig } from '@deep-fryer/contract';
import {
  acceptedScales,
  maxDataAgeYears,
  type FindingPayload,
  type FindingVerification,
  type IndicatorFindingPayload,
} from '@deep-fryer/core';
import { DEFAULT_CORRECTION_MAX_TURNS, DEFAULT_SESSION_MAX_TURNS } from './plan.js';

/** Deterministic pre-verifier failures that trigger a bounded researcher self-correction pass. */
export type CorrectionReason = 'value_not_found' | 'home_page_link';

export type DeterministicGateChecks = Omit<FindingVerification, 'content_supported' | 'verifier_note'>;

/**
 * Pure: which deterministic pre-verifier gates failed for one finding.
 * Only sourced indicator findings can fail these checks — gaps and
 * schema-invalid outputs return an empty list. `value_on_page === 'no_text'`
 * (scanned PDF or image without readable words) is NOT a deterministic
 * failure by itself; only `not_found` or `home_page_link === true` triggers
 * self-correction.
 */
export function correctionReasons(
  payload: FindingPayload | null,
  checks: DeterministicGateChecks,
): CorrectionReason[] {
  if (!payload || payload.kind !== 'indicator') return [];
  const reasons: CorrectionReason[] = [];
  if (checks.value_on_page === 'not_found') reasons.push('value_not_found');
  if (checks.home_page_link === true) reasons.push('home_page_link');
  return reasons;
}

export function needsPreVerifierCorrection(
  payload: FindingPayload | null,
  checks: DeterministicGateChecks,
): boolean {
  return correctionReasons(payload, checks).length > 0;
}

export interface FlaggedForCorrection {
  payload: IndicatorFindingPayload;
  checks: DeterministicGateChecks;
  reasons: CorrectionReason[];
}

export interface PreVerifierCorrectionPlan {
  prompt: string;
  flaggedSlugs: string[];
  maxTurns: number;
}

/**
 * Pure planner for the single bounded pre-verifier self-correction pass.
 * Returns null when no finding in the dimension failed `value_on_page` or
 * `home_page_link`. Otherwise renders a targeted diagnostic prompt naming
 * each exact failure and asking for the concrete table/PDF URL (with fresh
 * capture_evidence) or an honest gap, bounded to `min(DEFAULT_CORRECTION_MAX_TURNS, sessionMaxTurns)`.
 */
export function planPreVerifierCorrection(input: {
  config: PortraitConfig;
  dimensionSlug: string;
  dimensionName: string;
  regionBrief: string;
  flagged: readonly FlaggedForCorrection[];
  sessionMaxTurns?: number;
}): PreVerifierCorrectionPlan | null {
  if (input.flagged.length === 0) return null;

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

  const diagnostics = input.flagged
    .map((item, idx) => {
      const { payload, reasons } = item;
      const problems: string[] = [];
      if (reasons.includes('value_not_found')) {
        problems.push(
          `VALUE NOT FOUND ON CAPTURED PAGE: claimed value "${payload.value}" (${payload.unit}, ${payload.year}) was not found in the readable text extracted from ${payload.source_url}${
            payload.evidence.text_path ? ` (${payload.evidence.text_path})` : ''
          }. The linked page may be a landing page, an interactive viewer whose data lives in a downloadable table/PDF, or a misquoted/rounded figure.`,
        );
      }
      if (reasons.includes('home_page_link')) {
        problems.push(
          `HOME OR SECTION PAGE LINK: cited URL "${payload.source_url}" is a publisher home or top-level section page rather than a concrete report, data table, or direct PDF URL.`,
        );
      }
      return [
        `${idx + 1}. Indicator: ${payload.name} (slug: ${payload.indicator_slug}, unit: ${payload.unit})`,
        `   - Previous claim: ${payload.value} ${payload.unit} (${payload.year}, ${payload.geographic_scale} scale)`,
        `   - Previous source: ${payload.source} — ${payload.source_url}`,
        `   - Threshold / scoring ref: ${payload.scoring.threshold_ref} (${payload.scoring.function}, target: ${payload.target})`,
        `   - Deterministic gate failure(s):`,
        ...problems.map((p) => `     * ${p}`),
      ].join('\n');
    })
    .join('\n\n');

  const prompt = `# Pre-verification self-correction pass

One or more findings from your research pass for **${input.dimensionName}** (${input.config.region.name}) failed deterministic evidence checks before independent verification. You have ONE bounded pass to fix ONLY the flagged indicator(s) listed below.

## Region brief

${input.regionBrief}

## Flagged findings to correct

${diagnostics}

## Binding portrait rules

Source priority (exhaust tier N before tier N+1):
${tiersBlock}

- Recency: data must be from the last ${maxAge} years. Older data is a gap.
- Accepted geographic scales (in preference order): ${scales.join(' → ')}.

## Required actions

For EACH flagged indicator above:
1. Locate the concrete page, data table, or direct PDF URL that directly states the exact figure for the claimed geography and year. Do NOT cite a publisher home page or top-level section page.
2. Call \`capture_evidence\` on that concrete URL (passing \`pdf_url\` whenever the source is a PDF document) so the archived snapshot and extracted text contain the exact number, and copy the returned storage paths into \`evidence\`.
3. Re-verify the exact value, year, unit, geographic scale, and worked scoring math directly from the concrete source.
4. If no compliant source directly states the figure on a verifiable page or document, return an honest \`kind: "gap"\` finding naming the tiers/scales tried and why. An honest gap is always better than an unverifiable citation.

## Output

Return ONLY a JSON array containing one finding object per flagged indicator listed above (matching the exact \`indicator_slug\`), conforming to this schema:

\`\`\`json
${JSON.stringify(findingSchema, null, 1)}
\`\`\`

No prose before or after the JSON array.`;

  const sessionCap = input.sessionMaxTurns ?? DEFAULT_SESSION_MAX_TURNS;
  const maxTurns = Math.max(1, Math.min(DEFAULT_CORRECTION_MAX_TURNS, sessionCap));

  return {
    prompt,
    flaggedSlugs: input.flagged.map((f) => f.payload.indicator_slug),
    maxTurns,
  };
}

/**
 * Pure: whether a candidate finding returned by the bounded pre-verifier
 * self-correction pass should replace the original flagged finding.
 * - Schema-invalid outputs never replace the original finding.
 * - An honest `kind: "gap"` replaces an unsubstantiated/home-page-linked claim.
 * - A schema-valid `kind: "indicator"` replaces the original unless it
 *   regressed on url/recency/scale gates without resolving either
 *   `value_on_page` or `home_page_link`.
 */
export function shouldAcceptCorrection(
  original: { payload: IndicatorFindingPayload; checks: DeterministicGateChecks },
  corrected: { payload: FindingPayload | null; checks: DeterministicGateChecks },
): boolean {
  if (!corrected.payload) return false;
  if (corrected.payload.kind === 'gap') return true;
  if (corrected.payload.kind !== 'indicator') return false;

  const fixedValue = original.checks.value_on_page === 'not_found' && corrected.checks.value_on_page !== 'not_found';
  const fixedLink = original.checks.home_page_link === true && corrected.checks.home_page_link === false;
  const regressedGate =
    (original.checks.url_ok && !corrected.checks.url_ok) ||
    (original.checks.recency_ok && !corrected.checks.recency_ok) ||
    (original.checks.scale_ok && !corrected.checks.scale_ok);

  if (regressedGate && !fixedValue && !fixedLink) return false;
  return true;
}
