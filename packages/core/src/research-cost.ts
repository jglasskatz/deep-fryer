/**
 * What research costs in model usage (SPEC-v7 §4), as data: the estimate in
 * docs/research-cost.md, so the self-serve start page ("Build my doughnut")
 * and the billing page quote the same numbers the document derives — and a
 * change to the document's estimate is a change here, in one place. Every
 * figure shown to a customer is computed from the per-session constants
 * below (never typed into a page), so a quoted re-run and a quoted portrait
 * cannot drift apart.
 *
 * The figures are an estimate, not a meter: no research run had been
 * measured on this code when they were made (docs/research-cost.md,
 * "Status"). Actual usage per session is recorded on every run
 * (research_runs.token_usage) and analysis (policy_analyses.token_usage);
 * replace these constants with the measured averages after the first real
 * run ("Measuring it").
 */
import { SESSIONS_PER_FULL_REFRESH } from './plans.js';

/**
 * API cost of one full portrait — 22 research sessions plus their verifier
 * sessions — on the current code's models (Sonnet 5 researchers, Opus 5
 * verifiers), in US dollars. docs/research-cost.md, "Short answer":
 * "**≈ $40**" typical, "$20–80" range.
 */
export const FULL_PORTRAIT_COST_USD = { low: 20, typical: 40, high: 80 } as const;

/** When the estimate was last revised (docs/research-cost.md "Status"), shown next to quoted figures. */
export const RESEARCH_COST_ESTIMATED_ON = '2026-10-17';

/**
 * Cost per research session: the full-portrait figures spread over its
 * SESSIONS_PER_FULL_REFRESH (22) sessions — $0.91 / $1.82 / $3.64. The
 * typical figure, $40 / 22 ≈ $1.82, is the document's "~$1.80 per session"
 * ("What a plan's sessions cost", which prices the plan allowances from
 * it). A session's verifiers ride along in its share, because verifier
 * sessions are not counted separately against a plan either.
 */
export const RESEARCH_SESSION_COST_USD = {
  low: FULL_PORTRAIT_COST_USD.low / SESSIONS_PER_FULL_REFRESH,
  typical: FULL_PORTRAIT_COST_USD.typical / SESSIONS_PER_FULL_REFRESH,
  high: FULL_PORTRAIT_COST_USD.high / SESSIONS_PER_FULL_REFRESH,
} as const;

/**
 * Research sessions a run over `dimensionCount` dimensions plans — and so
 * charges, because the spend gate counts the plan's sessions
 * (apps/web/lib/research.ts applyRun). renderPlan (packages/research
 * plan.ts) always starts with the region-context session, whose brief goes
 * into every dimension prompt, then adds one session per dimension. So a
 * one-dimension re-run is two sessions, both charged, and every dimension,
 * researchRunSessions(21), is SESSIONS_PER_FULL_REFRESH.
 * packages/research plan-cost.test.ts holds this to renderPlan itself.
 */
export function researchRunSessions(dimensionCount: number): number {
  if (!Number.isInteger(dimensionCount) || dimensionCount < 1) {
    throw new RangeError(`a research run covers at least one whole dimension, got ${dimensionCount}`);
  }
  return 1 + dimensionCount;
}

export interface RunCostEstimate {
  sessions: number;
  lowUsd: number;
  typicalUsd: number;
  highUsd: number;
}

/** Round to whole cents (estimates are quoted in dollars; cents keep small runs nonzero). */
const cents = (usd: number) => Math.round(usd * 100) / 100;

/**
 * Estimated API cost of a run of `sessionCount` research sessions (a policy
 * analysis is one, POLICY_ANALYSIS_SESSIONS; a one-dimension re-run is two,
 * researchRunSessions(1)). A full portrait, estimateRunCost(22), is exactly
 * the document's $20 / $40 / $80; a re-run, estimateRunCost(2), is
 * $1.82 / $3.64 / $7.27.
 */
export function estimateRunCost(sessionCount: number): RunCostEstimate {
  if (!Number.isInteger(sessionCount) || sessionCount < 0) {
    throw new RangeError(`session count must be a whole number of sessions, got ${sessionCount}`);
  }
  return {
    sessions: sessionCount,
    lowUsd: cents(sessionCount * RESEARCH_SESSION_COST_USD.low),
    typicalUsd: cents(sessionCount * RESEARCH_SESSION_COST_USD.typical),
    highUsd: cents(sessionCount * RESEARCH_SESSION_COST_USD.high),
  };
}

/**
 * The range as people say it: "$20–80". Whole dollars, rounded outward
 * (down at the low end, up at the high end) so the quoted range always
 * contains the estimate; never below $1, because "$0" reads as free.
 */
export function formatCostRange(estimate: RunCostEstimate): string {
  const low = Math.max(1, Math.floor(estimate.lowUsd));
  const high = Math.max(low, Math.ceil(estimate.highUsd));
  return `$${low.toLocaleString('en-US')}–${high.toLocaleString('en-US')}`;
}

/**
 * The typical figure as people say it: "$40", "$240", "$3.60". Whole
 * dollars from $10 up; below that, to the nearest ten cents, because
 * rounding a $3.64 re-run to "$4" overstates it by a tenth and to "$3.64"
 * claims a precision an estimate does not have.
 */
export function formatTypicalCost(estimate: RunCostEstimate): string {
  const tenths = Math.round(estimate.typicalUsd * 10) / 10;
  if (tenths >= 10) return `$${Math.round(estimate.typicalUsd).toLocaleString('en-US')}`;
  return `$${tenths.toFixed(2)}`;
}
