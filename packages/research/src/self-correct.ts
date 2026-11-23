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
export type CorrectionReason =
  | 'value_not_found'
  | 'home_page_link'
  | 'url_failed'
  | 'recency_failed'
  | 'scale_failed'
  | 'missing_indicator';

export type DeterministicGateChecks = Omit<FindingVerification, 'content_supported' | 'verifier_note'>;

/**
 * Pure: which deterministic pre-verifier gates failed for one finding.
 * Only sourced indicator findings can fail these checks — gaps and
 * schema-invalid outputs return an empty list. `value_on_page === 'no_text'`
 * (scanned PDF or image without readable words) is NOT a deterministic
 * failure by itself; `not_found`, `home_page_link === true`, `!url_ok`,
 * `!recency_ok`, and `!scale_ok` each trigger self-correction.
 */
export function correctionReasons(
  payload: FindingPayload | null,
  checks: DeterministicGateChecks,
): CorrectionReason[] {
  if (!payload || payload.kind !== 'indicator') return [];
  const reasons: CorrectionReason[] = [];
  if (checks.value_on_page === 'not_found') reasons.push('value_not_found');
  if (checks.home_page_link === true) reasons.push('home_page_link');
  if (!checks.url_ok) reasons.push('url_failed');
  if (!checks.recency_ok) reasons.push('recency_failed');
  if (!checks.scale_ok) reasons.push('scale_failed');
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

export interface MissingPlannedIndicator {
  slug: string;
  name?: string;
  unit?: string;
  threshold_ref?: string;
}

export interface PreVerifierCorrectionPlan {
  prompt: string;
  flaggedSlugs: string[];
  maxTurns: number;
}

/**
 * Pure planner for the single bounded pre-verifier self-correction pass.
 * Returns null when no finding in the dimension failed deterministic gates
 * and no planned indicator was omitted. Otherwise renders a targeted diagnostic
 * prompt naming each exact failure and asking for the concrete table/PDF URL
 * (with fresh capture_evidence) or an honest gap, bounded to
 * `min(DEFAULT_CORRECTION_MAX_TURNS, sessionMaxTurns)`.
 */
export function planPreVerifierCorrection(input: {
  config: PortraitConfig;
  dimensionSlug: string;
  dimensionName: string;
  regionBrief: string;
  flagged: readonly FlaggedForCorrection[];
  missing?: readonly MissingPlannedIndicator[];
  sessionMaxTurns?: number;
}): PreVerifierCorrectionPlan | null {
  const missing = input.missing ?? [];
  if (input.flagged.length === 0 && missing.length === 0) return null;

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

  const flaggedDiagnostics = input.flagged.map((item, idx) => {
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
    if (reasons.includes('url_failed')) {
      problems.push(
        `URL DID NOT RESOLVE: cited URL "${payload.source_url}" failed link resolution (4xx/5xx/unreachable). Provide a working concrete report, table, or direct PDF URL and capture fresh evidence.`,
      );
    }
    if (reasons.includes('recency_failed')) {
      problems.push(
        `RECENCY POLICY FAILED: observation year ${payload.year} is outside the allowed window (last ${maxAge} years; future projections are not observations). Locate a compliant recent observation or emit an honest gap.`,
      );
    }
    if (reasons.includes('scale_failed')) {
      problems.push(
        `GEOGRAPHIC SCALE POLICY FAILED: geographic_scale "${payload.geographic_scale}" is not in the accepted scales for this dimension (${scales.join(' → ')}). Locate a source at an accepted scale or emit an honest gap.`,
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
  });

  const missingDiagnostics = missing.map((item, idx) => {
    const number = input.flagged.length + idx + 1;
    return [
      `${number}. Indicator: ${item.name ?? item.slug} (slug: ${item.slug}${item.unit ? `, unit: ${item.unit}` : ''})`,
      ...(item.threshold_ref ? [`   - Threshold ref: ${item.threshold_ref}`] : []),
      `   - Deterministic gate failure(s):`,
      `     * MISSING PLANNED INDICATOR: this planned indicator was omitted from the initial pass output. Research it now and emit either a verified kind: "indicator" finding with captured evidence or an honest kind: "gap" finding.`,
    ].join('\n');
  });

  const diagnostics = [...flaggedDiagnostics, ...missingDiagnostics].join('\n\n');

  const prompt = `# Pre-verification self-correction pass

One or more findings from your research pass for **${input.dimensionName}** (${input.config.region.name}) failed deterministic evidence checks before independent verification. You have ONE bounded pass to fix ONLY the flagged or missing indicator(s) listed below.

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

For EACH flagged or missing indicator above:
1. Locate the concrete page, data table, or direct PDF URL that directly states the exact figure for the claimed geography and year. Do NOT cite a publisher home page or top-level section page.
2. Call \`capture_evidence\` on that concrete URL (passing \`pdf_url\` whenever the source is a PDF document) so the archived snapshot and extracted text contain the exact number, and copy the returned storage paths into \`evidence\`.
3. Re-verify the exact value, year, unit, geographic scale, and worked scoring math directly from the concrete source.
4. If no compliant source directly states the figure on a verifiable page or document, return an honest \`kind: "gap"\` finding naming the tiers/scales tried and why. An honest gap is always better than an unverifiable citation.

## Output

If \`submit_findings\` is available, call it with the corrected findings array to validate them immediately; also return ONLY a JSON array containing one finding object per flagged indicator listed above (matching the exact \`indicator_slug\`), conforming to this schema:

\`\`\`json
${JSON.stringify(findingSchema, null, 1)}
\`\`\`

No prose before or after the JSON array.`;

  const sessionCap = input.sessionMaxTurns ?? DEFAULT_SESSION_MAX_TURNS;
  const maxTurns = Math.max(1, Math.min(DEFAULT_CORRECTION_MAX_TURNS, sessionCap));
  const flaggedSlugs = [
    ...input.flagged.map((f) => f.payload.indicator_slug),
    ...missing.map((m) => m.slug),
  ];

  return {
    prompt,
    flaggedSlugs: [...new Set(flaggedSlugs)],
    maxTurns,
  };
}

/**
 * Pure: whether a candidate finding returned by the bounded pre-verifier
 * self-correction pass should replace the original flagged finding.
 * - Schema-invalid outputs never replace the original finding.
 * - An honest `kind: "gap"` replaces an unsubstantiated/non-compliant claim.
 * - A schema-valid `kind: "indicator"` must NOT regress ANY deterministic gate
 *   (`url_ok`, `recency_ok`, `scale_ok`, newly introduced `home_page_link`,
 *   or newly lost `value_on_page === 'found'`), AND must strictly resolve at
 *   least one triggering defect (`value_on_page === 'found'` when fixing
 *   `value_not_found`, `home_page_link === false` when fixing `home_page_link`,
 *   or passing a previously failed `url_ok` / `recency_ok` / `scale_ok`).
 */
export function shouldAcceptCorrection(
  original: { payload: IndicatorFindingPayload; checks: DeterministicGateChecks },
  corrected: { payload: FindingPayload | null; checks: DeterministicGateChecks },
): boolean {
  if (!corrected.payload) return false;
  if (corrected.payload.kind === 'gap') return true;
  if (corrected.payload.kind !== 'indicator') return false;

  // Reject ANY deterministic gate regression unconditionally.
  if (original.checks.url_ok && !corrected.checks.url_ok) return false;
  if (original.checks.recency_ok && !corrected.checks.recency_ok) return false;
  if (original.checks.scale_ok && !corrected.checks.scale_ok) return false;
  if (original.checks.home_page_link !== true && corrected.checks.home_page_link === true) return false;
  if (original.checks.value_on_page === 'found' && corrected.checks.value_on_page !== 'found') return false;

  // Require resolving at least one triggering defect strictly.
  const fixedValue = original.checks.value_on_page === 'not_found' && corrected.checks.value_on_page === 'found';
  const fixedLink = original.checks.home_page_link === true && corrected.checks.home_page_link === false;
  const fixedUrl = !original.checks.url_ok && corrected.checks.url_ok;
  const fixedRecency = !original.checks.recency_ok && corrected.checks.recency_ok;
  const fixedScale = !original.checks.scale_ok && corrected.checks.scale_ok;

  return fixedValue || fixedLink || fixedUrl || fixedRecency || fixedScale;
}
