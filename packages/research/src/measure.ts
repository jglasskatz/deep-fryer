import {
  emptyUsage,
  mergeUsage,
  priceSessionUsage,
  type FindingPayload,
  type FindingVerification,
  type GeographicScale,
  type SessionTokenUsage,
} from '@deep-fryer/core';

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

/**
 * Per-session spend is already attributable: the worker keys RunTokenUsage by
 * session id, and files that session's verifier calls under `verifier:<id>`.
 * Both belong to the strategy under test, so both are charged to it — as
 * whole records (core mergeUsage), so cache tokens, per-model usage and web
 * searches reach the price, not just input and output. Rows written before
 * per-model metering hold only input and output tokens; they fold the same
 * way and price as unpriced (core priceSessionUsage), never as zero.
 */
export function sessionSpend(
  runUsage: Record<string, SessionTokenUsage> | null | undefined,
  sessionId: string,
): SessionTokenUsage {
  let total = emptyUsage();
  if (!runUsage) return total;
  for (const key of [sessionId, `verifier:${sessionId}`]) {
    const u = runUsage[key];
    if (u) total = mergeUsage(total, u);
  }
  return total;
}

/**
 * Every indicator a run's plan asked its dimension sessions to research, as
 * `dimension/indicator` keys — the coverage denominator (docs/measurement.md:
 * coverage is non-gap findings ÷ indicators attempted). Counting the findings
 * a session returned instead would let a session that returned nothing — bad
 * JSON, a refusal, the turn cap — leave coverage and yield untouched.
 *
 * Read from the rendered prompts, which are the run's record of what was
 * asked: plan.ts renders each indicator as `  - <name> (slug: <slug>, unit:
 * <unit>)` (the guard test renders a plan and reads it back).
 */
export function plannedIndicators(plan: {
  sessions: { kind: string; dimension_slug?: string; prompt: string }[];
}): string[] {
  const keys = new Set<string>();
  for (const session of plan.sessions) {
    if (session.kind !== 'dimension') continue;
    for (const m of session.prompt.matchAll(/^ {2}- .*\(slug: ([a-z0-9][a-z0-9-]*), unit: /gm)) {
      keys.add(`${session.dimension_slug ?? ''}/${m[1]}`);
    }
  }
  return [...keys];
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface Scorecard {
  /** Indicators the plan asked for (plannedIndicators): the coverage denominator. */
  indicators: number;
  /** Findings returned, gaps included. */
  returned: number;
  /** Planned indicators the sessions returned no finding for at all (planned − returned, floored at 0). */
  missing: number;
  findings: number;
  gaps: number;
  /**
   * Non-gap findings ÷ indicators planned. Above 1 only if sessions returned
   * more than one value for an indicator.
   */
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
  /** Share of returned findings salvaged from malformed session output (partial_output). */
  partialOutput: number;
  /** Input + output tokens per verified finding (the measure used before dollars were metered). */
  costPerVerifiedFinding: number | null;
  /**
   * What the strategy's sessions cost, priced from per-model usage (core
   * priceSessionUsage). A lower bound while `unpriced` is non-empty.
   */
  dollars: number | null;
  /**
   * Dollars per verified finding — only when every model is priced and
   * something verified. Comparing strategies on a partial price is how a
   * cheap-looking arm wins on the part of its bill nobody priced.
   */
  costPerVerifiedFindingUsd: number | null;
  /** Models whose tokens are not in `dollars` (unknown ids, or not yet priced). */
  unpriced: string[];
  tokens: SessionTokenUsage | null;
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

/**
 * Reduce a strategy's output to one comparable row.
 *
 * Coverage divides by the indicators the plan asked for (plannedIndicators),
 * not by the findings that came back: a session that returned nothing —
 * malformed JSON, a refusal, the turn cap, the failure modes a cheaper model
 * is likeliest to show — must lower coverage and yield, not vanish from them.
 *
 * Spend is the strategy's folded usage records (sessionSpend, core
 * mergeUsage), priced per model (core priceSessionUsage) into `dollars`.
 *
 * Note that the deterministic gates are reported but never folded into yield:
 * published evaluations of research agents find link-validity and relevance
 * hold steady (>94% / >80%) while factual accuracy degrades to as low as 39%.
 * Surface metrics are precisely the ones that fail to move when a strategy
 * goes bad, so they are diagnostics here, not scores.
 */
export function scoreStrategy(
  findings: ScoredFinding[],
  input: { indicatorsPlanned: number; tokens?: SessionTokenUsage | null },
): Scorecard {
  const { indicatorsPlanned } = input;
  const tokens = input.tokens ?? null;
  const total = findings.length;
  const gaps = findings.filter((f) => f.payload.kind === 'gap');
  const nonGap = findings.filter((f) => f.payload.kind === 'indicator');

  const verdict = (f: ScoredFinding) => f.verification?.content_supported ?? 'uncertain';
  const passes = nonGap.filter((f) => verdict(f) === 'pass');
  const fails = nonGap.filter((f) => verdict(f) === 'fail');
  const uncertain = nonGap.filter((f) => verdict(f) === 'uncertain');

  const coverage = ratio(nonGap.length, indicatorsPlanned);
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
  const priced = tokens ? priceSessionUsage(tokens) : null;

  return {
    indicators: indicatorsPlanned,
    returned: total,
    missing: Math.max(0, indicatorsPlanned - total),
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
    partialOutput: gateShare((v) => v.partial_output === true),
    costPerVerifiedFinding: spend === null || passes.length === 0 ? null : spend / passes.length,
    dollars: priced ? priced.dollars : null,
    costPerVerifiedFindingUsd:
      priced && priced.unpriced.length === 0 && passes.length > 0 ? priced.dollars / passes.length : null,
    unpriced: priced ? priced.unpriced : [],
    tokens,
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
 * Rates use a weighted mean; absolute counts sum. The denominator decides
 * the operation and weight, and proxy denominators are indicative only.
 */
export type Denominator = 'population' | 'households' | 'subpopulation' | 'sum' | 'non-additive';

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
  // Absolute counts (NYC custom indicators): boroughs sum to the city.
  'traffic-deaths': 'sum',
  'new-affordable-homes-per-year': 'sum',
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
    if (typeof cityValue !== 'number' || !Number.isFinite(cityValue)) continue;

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
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (denominator === 'sum') {
        // Regional/state/global figures cannot decompose municipal totals.
        // Geographic truth within city/county labels remains the independent
        // verifier's job; year and unit comparability are deterministic.
        if (match.payload.geographic_scale !== 'city' && match.payload.geographic_scale !== 'county') continue;
        if (match.payload.year !== cityFinding.payload.year || match.payload.unit !== cityFinding.payload.unit) continue;
        weighted += v;
      } else {
        if (!Number.isFinite(b.population) || b.population <= 0) continue;
        weighted += v * b.population;
        weight += b.population;
      }
      n += 1;
    }
    if (n < 2 || (denominator === 'sum' ? n !== input.boroughs.length : weight === 0)) continue;

    const impliedValue = denominator === 'sum' ? weighted : weighted / weight;
    const divergencePct =
      cityValue === 0 ? (impliedValue === 0 ? 0 : Infinity) : ((impliedValue - cityValue) / Math.abs(cityValue)) * 100;
    const approximate = denominator !== 'population' && denominator !== 'sum';
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
 * Indicators where the correct answer at the municipality's own scale is a
 * gap. Without a positive gold set these are the only direct measure of
 * fabrication pressure: a strategy that returns a confident municipal value
 * here invented it. A sourced, verified value at an accepted wider scale is
 * not one (controlExempt).
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
  /**
   * The value is not counted as fabricated: it is sourced, passed the
   * verifier, and sits at an accepted scale wider than the municipality
   * (controlExempt). Only set on a value.
   */
  exempt?: boolean;
  /** The value counted as fabricated; absent on a gap or an exempt value. */
  fabricatedValue?: number | string;
}

/**
 * The scales a negative control says no source can exist at: the
 * municipality itself. A value at a wider scale is a different claim.
 */
const CONTROL_LOCAL_SCALES: readonly GeographicScale[] = ['city', 'county'];

/**
 * Pure: whether a value on a negative control is honest rather than
 * invented (docs/strategy-findings.md, "miscalibrated controls"): a sourced
 * value (it passed the finding schema, which requires a source, its URL and
 * an evidence snapshot), that the verifier passed, at a scale the portrait
 * accepts for the dimension (scale_ok) and wider than the municipality
 * (regional, state, national, global). That is exactly what the scale policy
 * permits — the Opus arm's Long Island Sound Ω = 1.09, labelled `regional` —
 * whereas an unsourced, unverified or borough-scale value (the Sonnet arm's
 * ODS "99%") remains a fabrication.
 */
export function controlExempt(f: ScoredFinding): boolean {
  const v = f.verification;
  return (
    f.payload.kind === 'indicator' &&
    !!v &&
    v.schema_ok &&
    v.scale_ok &&
    v.content_supported === 'pass' &&
    Boolean(f.payload.source_url) &&
    !CONTROL_LOCAL_SCALES.includes(f.payload.geographic_scale)
  );
}

export function scoreNegativeControls(
  findings: ScoredFinding[],
  controls: NegativeControl[] = NEGATIVE_CONTROLS,
): { results: ControlResult[]; fabricationRate: number } {
  const slugs = new Set(controls.map((c) => c.indicatorSlug));
  const relevant = findings.filter((f) => slugs.has(f.indicatorSlug));

  const results = relevant.map<ControlResult>((f) => {
    if (f.payload.kind === 'gap') {
      return { indicatorSlug: f.indicatorSlug, tenantSlug: f.tenantSlug, correct: true, observed: 'gap' };
    }
    const exempt = controlExempt(f);
    return {
      indicatorSlug: f.indicatorSlug,
      tenantSlug: f.tenantSlug,
      correct: exempt,
      observed: 'value',
      ...(exempt ? { exempt: true } : { fabricatedValue: f.payload.value }),
    };
  });

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
 * allowlist reads archives and cited pages but cannot search, so it can
 * verify the claim but can never discover the tier-1 source that was
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
  const firstTier = input.claimed_tier === 1;
  return `# Tier-compliance auditor

A research agent accepted a tier-${input.claimed_tier} source for one indicator.
${firstTier
  ? 'Your job is to verify the tier-1 attribution: the cited publisher must be the relevant primary authority for this region and indicator. There is no higher tier than tier 1.'
  : 'Your job is to find out whether a source in a higher-priority tier existed and was missed.'}
You are not checking the number — another verifier does that.

## The finding

- Region: ${input.region_name}
- Indicator: ${input.indicator_name}
- Value: ${input.claimed_value} ${input.unit} (${input.year})
- Accepted source: ${input.source_name} (${input.source_url})
- Claimed tier: ${input.claimed_tier}

## The tier ladder (binding portrait config)

${input.tiers_block}

## Your job

${firstTier
  ? `Read the cited source and identify who actually produced the statistic, the
geography it describes, and its construct/denominator. Check those against
the region and tier ladder. A local-looking domain or a press release that
repeats another publisher's data is not automatically a tier-1 primary source.
Search the relevant authority's original release when attribution is unclear.
Do not search for an impossible tier below 1. If the claim is misclassified,
report the actual tier in found_tier and the attribution problem in note.`
  : `Search for a source in any tier numbered below ${input.claimed_tier} that publishes this
indicator for this region and year. Look specifically at the region's own
statistical publications before anything else. Fetch what you find — do not
judge from search snippets.`}

Return ONLY:

\`\`\`json
{
  "higher_tier_source_existed": true | false,
  "claimed_tier_supported": true | false | null,
  "found_tier": <integer or null>,
  "found_url": "<url or null>",
  "note": "one or two sentences on what you searched and what you found"
}
\`\`\`

${firstTier
  ? 'Set higher_tier_source_existed to false (there is no tier 0). Set claimed_tier_supported to false for a demonstrated attribution/construct mismatch, true for verified attribution, and null when the evidence is inconclusive. Do not interpret false on the higher-tier question as endorsement of the cited source.'
  : 'Answer false on higher_tier_source_existed only after searching the higher tiers directly. A missed tier-1 source is the failure this audit exists to catch — do not give the researcher the benefit of the doubt. Set claimed_tier_supported to null unless you independently checked the accepted source’s classification.'}`;
}
