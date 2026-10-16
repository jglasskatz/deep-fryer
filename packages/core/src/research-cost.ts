/**
 * What research costs in model usage (SPEC-v7 §4), as data: the estimate in
 * docs/research-cost.md, so the self-serve start page ("Build my doughnut")
 * and the billing page quote the same numbers the document derives — and a
 * change to the document's estimate is a change here, in one place.
 *
 * The figures are an estimate, not a meter: no real research run had been
 * recorded when they were made (docs/research-cost.md, "Status"). Actual
 * usage per session is recorded on every run (research_runs.token_usage)
 * and analysis (policy_analyses.token_usage); replace these constants with
 * the measured averages after the first real run ("Measuring it").
 */
import { SESSIONS_PER_FULL_REFRESH } from './plans.js';

/**
 * API cost of one full portrait — 22 research sessions plus their verifier
 * sessions — on the current code's models (Sonnet 5 researchers, Opus 5
 * verifiers), in US dollars. docs/research-cost.md, "Short answer":
 * "**≈ $40**" typical, "$20–80" range.
 */
export const FULL_PORTRAIT_COST_USD = { low: 20, typical: 40, high: 80 } as const;

/** When the estimate was made (docs/research-cost.md "Status"), shown next to quoted figures. */
export const RESEARCH_COST_ESTIMATED_ON = '2026-10-16';

/**
 * Cost per research session: the full-portrait figures spread over its
 * SESSIONS_PER_FULL_REFRESH (22) sessions. The typical figure, $40 / 22 ≈
 * $1.82, is the document's "~$1.80 per session" (Recommendations §3, which
 * prices the plan allowances from it). A session's verifiers ride along in
 * its share, because verifier sessions are not counted separately against
 * a plan either. A one-dimension re-run's own range in the document
 * ($1.50–3) sits inside this per-session range.
 */
export const RESEARCH_SESSION_COST_USD = {
  low: FULL_PORTRAIT_COST_USD.low / SESSIONS_PER_FULL_REFRESH,
  typical: FULL_PORTRAIT_COST_USD.typical / SESSIONS_PER_FULL_REFRESH,
  high: FULL_PORTRAIT_COST_USD.high / SESSIONS_PER_FULL_REFRESH,
} as const;

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
 * analysis is one). A full portrait, estimateRunCost(22), is exactly the
 * document's $20 / $40 / $80.
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
