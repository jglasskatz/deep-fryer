import type { FindingPayload, FindingVerification } from '@deep-fryer/core';

/**
 * Strategy measurement (methodology addendum to SPEC.md §8).
 *
 * The research plane verifies individual findings. This module measures the
 * *strategy* that produced them, so two configurations can be compared on a
 * fixed budget before committing to a 132-session run.
 *
 * The instruments here are deliberately label-free: no hand-built gold set,
 * so no absolute accuracy claim. They rank strategies against each other and
 * detect specific failure modes. See `docs/measurement.md`.
 */

export interface ScoredFinding {
  indicatorSlug: string;
  dimensionSlug: string;
  tenantSlug: string;
  payload: FindingPayload;
  verification: FindingVerification | null;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Per-session spend is already attributable: the worker keys RunTokenUsage by
 * session id, and files that session's verifier calls under `verifier:<id>`.
 * Both belong to the strategy under test, so both are charged to it.
 */
export function sessionSpend(
  runUsage: Record<string, TokenUsage> | null | undefined,
  sessionId: string,
): TokenUsage {
  const total: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  if (!runUsage) return total;
  for (const key of [sessionId, `verifier:${sessionId}`]) {
    const u = runUsage[key];
    if (!u) continue;
    total.input_tokens += u.input_tokens;
    total.output_tokens += u.output_tokens;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface Scorecard {
  indicators: number;
  findings: number;
  gaps: number;
  /** Non-gap findings ÷ indicators attempted. */
  coverage: number;
  /** content_supported === 'pass' ÷ non-gap findings. */
  verifiedAccuracy: number;
  /**
   * coverage × verifiedAccuracy. The headline metric: the all-gap strategy
   * scores 0 on coverage, the reckless strategy scores 0 on accuracy, so
   * neither degenerate case can win on yield.
   */
  yield: number;
  /** content_supported === 'fail' ÷ non-gap. A citation that does not say it. */
  fabricationRate: number;
  /** content_supported === 'uncertain' ÷ non-gap. Paywalls, ambiguity. */
  uncertainRate: number;
  /** Deterministic gate pass rates — surface metrics, reported for contrast. */
  schemaOk: number;
  urlOk: number;
  recencyOk: number;
  scaleOk: number;
  /** Self-reported tier distribution. Unaudited — see auditTierCompliance. */
  tierShares: Record<number, number>;
  tier1Share: number;
  costPerVerifiedFinding: number | null;
  tokens: TokenUsage | null;
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

/**
 * Reduce a strategy's output to one comparable row.
 *
 * Note that the deterministic gates are reported but never folded into yield:
 * published evaluations of research agents find link-validity and relevance
 * hold steady (>94% / >80%) while factual accuracy degrades to as low as 39%.
 * Surface metrics are precisely the ones that fail to move when a strategy
 * goes bad, so they are diagnostics here, not scores.
 */
export function scoreStrategy(findings: ScoredFinding[], tokens?: TokenUsage | null): Scorecard {
  const total = findings.length;
  const gaps = findings.filter((f) => f.payload.kind === 'gap');
  const nonGap = findings.filter((f) => f.payload.kind === 'indicator');

  const verdict = (f: ScoredFinding) => f.verification?.content_supported ?? 'uncertain';
  const passes = nonGap.filter((f) => verdict(f) === 'pass');
  const fails = nonGap.filter((f) => verdict(f) === 'fail');
  const uncertain = nonGap.filter((f) => verdict(f) === 'uncertain');

  const coverage = ratio(nonGap.length, total);
  const verifiedAccuracy = ratio(passes.length, nonGap.length);

  const tierShares: Record<number, number> = {};
  for (const f of nonGap) {
    if (f.payload.kind !== 'indicator') continue;
    const tier = f.payload.source_tier;
    tierShares[tier] = (tierShares[tier] ?? 0) + 1;
  }
  for (const [tier, count] of Object.entries(tierShares)) {
    tierShares[Number(tier)] = ratio(count, nonGap.length);
  }

  const gateShare = (pick: (v: FindingVerification) => boolean) =>
    ratio(findings.filter((f) => (f.verification ? pick(f.verification) : false)).length, total);

  const spend = tokens ? tokens.input_tokens + tokens.output_tokens : null;

  return {
    indicators: total,
    findings: nonGap.length,
    gaps: gaps.length,
    coverage,
    verifiedAccuracy,
    yield: coverage * verifiedAccuracy,
    fabricationRate: ratio(fails.length, nonGap.length),
    uncertainRate: ratio(uncertain.length, nonGap.length),
    schemaOk: gateShare((v) => v.schema_ok),
    urlOk: gateShare((v) => v.url_ok),
    recencyOk: gateShare((v) => v.recency_ok),
    scaleOk: gateShare((v) => v.scale_ok),
    tierShares,
    tier1Share: tierShares[1] ?? 0,
    costPerVerifiedFinding: spend === null || passes.length === 0 ? null : spend / passes.length,
    tokens: tokens ?? null,
  };
}

// ---------------------------------------------------------------------------
// Instrument A — independent replication (label-free)
// ---------------------------------------------------------------------------

export interface AgreementRow {
  indicatorSlug: string;
  k: number;
  /** Distinct non-gap values seen across runs. */
  values: (number | string)[];
  /** max−min ÷ |mean|, numeric values only. null when non-numeric or k<2. */
  relativeSpread: number | null;
  /** Share of runs that picked the modal source URL. */
  sourceAgreement: number;
  /** Share of runs that agreed on the modal source tier. */
  tierAgreement: number;
  /** Runs that returned a gap where others returned a value. */
  gapDisagreement: number;
  /** True when runs disagree enough that a human should look. */
  contested: boolean;
}

const SPREAD_TOLERANCE = 0.02;

/**
 * Compare k independent runs of the same dimension. Needs no ground truth:
 * convergence on both the number *and* the primary source is the signal, and
 * divergence is a difficulty flag that doubles as review-queue triage.
 */
export function replicationAgreement(runs: ScoredFinding[][]): AgreementRow[] {
  const bySlug = new Map<string, ScoredFinding[]>();
  for (const run of runs) {
    for (const f of run) {
      const list = bySlug.get(f.indicatorSlug) ?? [];
      list.push(f);
      bySlug.set(f.indicatorSlug, list);
    }
  }

  const rows: AgreementRow[] = [];
  for (const [indicatorSlug, all] of bySlug) {
    const indicators = all.filter((f) => f.payload.kind === 'indicator');
    const gapCount = all.length - indicators.length;

    const values = indicators.map((f) =>
      f.payload.kind === 'indicator' ? f.payload.value : '',
    );
    const numeric = values.filter((v): v is number => typeof v === 'number');

    let relativeSpread: number | null = null;
    if (numeric.length >= 2) {
      const mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
      relativeSpread =
        mean === 0 ? 0 : (Math.max(...numeric) - Math.min(...numeric)) / Math.abs(mean);
    }

    const sourceAgreement = modalShare(
      indicators.map((f) => (f.payload.kind === 'indicator' ? f.payload.source_url : '')),
    );
    const tierAgreement = modalShare(
      indicators.map((f) => (f.payload.kind === 'indicator' ? String(f.payload.source_tier) : '')),
    );

    rows.push({
      indicatorSlug,
      k: all.length,
      values: [...new Set(values)],
      relativeSpread,
      sourceAgreement,
      tierAgreement,
      gapDisagreement: gapCount > 0 && indicators.length > 0 ? gapCount : 0,
      contested:
        (relativeSpread !== null && relativeSpread > SPREAD_TOLERANCE) ||
        (gapCount > 0 && indicators.length > 0),
    });
  }
  return rows.sort((a, b) => a.indicatorSlug.localeCompare(b.indicatorSlug));
}

function modalShare(items: string[]): number {
  if (items.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return Math.max(...counts.values()) / items.length;
}

// ---------------------------------------------------------------------------
// Instrument B — borough reconciliation (label-free coherence)
// ---------------------------------------------------------------------------

/**
 * Every framework indicator is intensive — a rate, share, or per-capita
 * figure. None are summable counts, so reconciliation is always a weighted
 * mean, never a sum. The denominator decides the weight, and where the
 * denominator is not a headcount the check is indicative rather than exact.
 */
export type Denominator = 'population' | 'households' | 'subpopulation' | 'non-additive';

/**
 * Indicators whose denominator is not total population. Anything absent
 * defaults to 'population'. 'non-additive' indicators are skipped entirely:
 * a planetary boundary measured globally has no borough decomposition, and
 * an index is not a mean of indices.
 */
export const DENOMINATORS: Record<string, Denominator> = {
  // Denominator is households, not residents.
  'broadband-access': 'households',
  'energy-burden': 'households',
  // Denominator is a subset of residents (renters, labor force, registered
  // voters, adults 25+, under-65s, the served population).
  'cost-burdened-renters': 'subpopulation',
  'unemployment-rate': 'subpopulation',
  'voter-turnout': 'subpopulation',
  'hs-attainment': 'subpopulation',
  'uninsured-rate': 'subpopulation',
  'safe-drinking-water': 'subpopulation',
  // Ratios and indices: the city figure is not a weighted mean of the parts.
  // A Gini coefficient over the union is not the average of five Ginis, and a
  // ratio of medians does not decompose at all.
  'gini-index': 'non-additive',
  'gender-pay-ratio': 'non-additive',
  // Concentrations and land-area shares: weighting by population is simply
  // the wrong weight, so no reconciliation is attempted.
  'nitrate-groundwater': 'non-additive',
  'protected-land-share': 'non-additive',
  'natural-land-conversion': 'non-additive',
  // Planetary boundaries with no municipal decomposition at all.
  'aragonite-saturation': 'non-additive',
  'ods-phaseout-compliance': 'non-additive',
  // Absolute counts (NYC custom indicators): boroughs sum to the city, they
  // do not population-weight to it. Excluded until the instrument grows a
  // sum-reconciliation mode.
  'traffic-deaths': 'non-additive',
  'new-affordable-homes-per-year': 'non-additive',
};

/**
 * Indicator slugs classified above that are portrait-level custom indicators
 * (tenant config), not framework indicators. The guard test accepts exactly
 * framework ∪ this list, so a typo in a framework slug still fails loudly.
 */
export const CUSTOM_INDICATOR_SLUGS = ['traffic-deaths', 'new-affordable-homes-per-year'];

export interface ReconciliationInput {
  city: ScoredFinding[];
  boroughs: { tenantSlug: string; population: number; findings: ScoredFinding[] }[];
}

export interface ReconciliationRow {
  indicatorSlug: string;
  cityValue: number;
  impliedValue: number;
  /** (implied − city) ÷ |city| × 100. */
  divergencePct: number;
  denominator: Denominator;
  /** Boroughs contributing a numeric value. */
  n: number;
  /** True when the weighting is a proxy, so the check is indicative only. */
  approximate: boolean;
  exceedsTolerance: boolean;
}

/** Population-weighted means with a proxy denominator carry real error. */
const EXACT_TOLERANCE_PCT = 5;
const APPROXIMATE_TOLERANCE_PCT = 15;

/**
 * The six-portrait structure yields a free internal-validity test: the five
 * boroughs must reconcile to the city figure. Coherence is a named criterion
 * in the ESS quality framework, and it is the one dimension the per-finding
 * verifier cannot see — it only ever looks at one claim at a time.
 */
export function reconcileBoroughs(input: ReconciliationInput): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];

  for (const cityFinding of input.city) {
    if (cityFinding.payload.kind !== 'indicator') continue;
    const cityValue = cityFinding.payload.value;
    if (typeof cityValue !== 'number') continue;

    const slug = cityFinding.indicatorSlug;
    const denominator = DENOMINATORS[slug] ?? 'population';
    if (denominator === 'non-additive') continue;

    let weighted = 0;
    let weight = 0;
    let n = 0;
    for (const b of input.boroughs) {
      const match = b.findings.find((f) => f.indicatorSlug === slug);
      if (!match || match.payload.kind !== 'indicator') continue;
      const v = match.payload.value;
      if (typeof v !== 'number') continue;
      weighted += v * b.population;
      weight += b.population;
      n += 1;
    }
    if (n < 2 || weight === 0) continue;

    const impliedValue = weighted / weight;
    const divergencePct =
      cityValue === 0 ? 0 : ((impliedValue - cityValue) / Math.abs(cityValue)) * 100;
    const approximate = denominator !== 'population';
    const tolerance = approximate ? APPROXIMATE_TOLERANCE_PCT : EXACT_TOLERANCE_PCT;

    rows.push({
      indicatorSlug: slug,
      cityValue,
      impliedValue,
      divergencePct,
      denominator,
      n,
      approximate,
      exceedsTolerance: Math.abs(divergencePct) > tolerance,
    });
  }

  return rows.sort((a, b) => Math.abs(b.divergencePct) - Math.abs(a.divergencePct));
}

// ---------------------------------------------------------------------------
// Instrument C — negative controls (fabrication pressure)
// ---------------------------------------------------------------------------

export interface NegativeControl {
  indicatorSlug: string;
  /** Why no compliant source can exist at the configured scale. */
  rationale: string;
}

/**
 * Indicators where the correct answer is a gap. Without a positive gold set
 * these are the only direct measure of fabrication pressure: a strategy that
 * returns a confident value here invented it.
 *
 * Paired with coverage in the scorecard so the inverse degenerate strategy —
 * answering everything with a gap — cannot win either.
 */
export const NEGATIVE_CONTROLS: NegativeControl[] = [
  {
    indicatorSlug: 'aragonite-saturation',
    rationale:
      'Ocean chemistry has no borough decomposition; any borough-specific Ω value is fabricated.',
  },
  {
    indicatorSlug: 'ods-phaseout-compliance',
    rationale:
      'Montreal Protocol compliance is tracked nationally by treaty party; no municipality reports it.',
  },
];

export interface ControlResult {
  indicatorSlug: string;
  tenantSlug: string;
  correct: boolean;
  observed: 'gap' | 'value';
  fabricatedValue?: number | string;
}

export function scoreNegativeControls(
  findings: ScoredFinding[],
  controls: NegativeControl[] = NEGATIVE_CONTROLS,
): { results: ControlResult[]; fabricationRate: number } {
  const slugs = new Set(controls.map((c) => c.indicatorSlug));
  const relevant = findings.filter((f) => slugs.has(f.indicatorSlug));

  const results = relevant.map<ControlResult>((f) => ({
    indicatorSlug: f.indicatorSlug,
    tenantSlug: f.tenantSlug,
    correct: f.payload.kind === 'gap',
    observed: f.payload.kind === 'gap' ? 'gap' : 'value',
    fabricatedValue: f.payload.kind === 'indicator' ? f.payload.value : undefined,
  }));

  return {
    results,
    fabricationRate: ratio(results.filter((r) => !r.correct).length, results.length),
  };
}

// ---------------------------------------------------------------------------
// Instrument D — tier-compliance audit
// ---------------------------------------------------------------------------

/**
 * `source_tier` is written by the researcher and never checked: the verifier's
 * allowlist is WebFetch only (see VERIFIER_TOOLS), so by construction it can
 * refetch the cited page but can never discover the tier-1 source that was
 * skipped. That makes tier compliance — the whole basis of the "NYC's own
 * data" claim — the one assertion the pipeline takes on trust.
 *
 * This renders the prompt for a separate auditor that *does* get WebSearch,
 * run over a sample rather than every finding.
 */
export const TIER_AUDIT_TOOLS = ['WebSearch', 'WebFetch'];

export function renderTierAuditPrompt(input: {
  indicator_name: string;
  claimed_value: string;
  unit: string;
  year: string;
  source_name: string;
  source_url: string;
  claimed_tier: number;
  tiers_block: string;
  region_name: string;
}): string {
  return `# Tier-compliance auditor

A research agent accepted a tier-${input.claimed_tier} source for one indicator.
Your job is to find out whether a source in a *higher* tier existed and was
missed. You are not checking the number — another verifier does that.

## The finding

- Region: ${input.region_name}
- Indicator: ${input.indicator_name}
- Value: ${input.claimed_value} ${input.unit} (${input.year})
- Accepted source: ${input.source_name} (${input.source_url})
- Claimed tier: ${input.claimed_tier}

## The tier ladder (binding portrait config)

${input.tiers_block}

## Your job

Search for a source in any tier below ${input.claimed_tier} that publishes this
indicator for this region and year. Look specifically at the region's own
statistical publications before anything else. Fetch what you find — do not
judge from search snippets.

Return ONLY:

\`\`\`json
{
  "higher_tier_source_existed": true | false,
  "found_tier": <integer or null>,
  "found_url": "<url or null>",
  "note": "one or two sentences on what you searched and what you found"
}
\`\`\`

Answer \`false\` only after searching the higher tiers directly. A missed
tier-1 source is the failure this audit exists to catch — do not give the
researcher the benefit of the doubt.`;
}
