import {
  POLICY_ANALYSIS_SESSIONS,
  RESEARCH_COST_ESTIMATED_ON,
  SESSIONS_PER_FULL_REFRESH,
  estimateRunCost,
  formatCostRange,
  formatTypicalCost,
  researchRunSessions,
} from '@deep-fryer/core';

/** "1 session", "2 research sessions" — counts here are computed, so the plural must be too. */
const sessionCount = (n: number, noun = 'session') => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The API-usage estimate for research (SPEC-v7 §4, docs/research-cost.md),
 * worded the way the spec quotes it: "about 22 sessions ≈ $20–80 of API
 * usage on your key". Used on the billing page next to the API key form and
 * on /start before "Build my doughnut", so both quote the same numbers from
 * @deep-fryer/core research-cost. Every figure — session counts included —
 * is computed there, never typed here: a one-dimension re-run is
 * researchRunSessions(1), the two sessions the gate actually charges.
 *
 * Who pays the dollars is always said: on the organization's own key, its
 * Anthropic bill; otherwise the plan's research sessions cover them, never a
 * charge on top — a buyer reading a bare "$20–80" beside "choose a plan"
 * would take it for the price of building, or for an extra.
 */
export function ResearchCostEstimate({
  sessions = SESSIONS_PER_FULL_REFRESH,
  onKey,
  showSingleSession = false,
}: {
  sessions?: number;
  /** Whether the sessions would run on the organization's own key ("of API usage on your key"). */
  onKey: boolean;
  /** Also quote the small runs: a policy analysis (one session) and a one-dimension re-run (two). */
  showSingleSession?: boolean;
}) {
  const run = estimateRunCost(sessions);
  const analysis = estimateRunCost(POLICY_ANALYSIS_SESSIONS);
  const rerun = estimateRunCost(researchRunSessions(1));
  return (
    <div className="text-sm">
      <p>
        {sessions === SESSIONS_PER_FULL_REFRESH ? 'A full portrait is about ' : 'About '}
        <strong>
          {sessionCount(sessions, 'research session')} ≈ {formatCostRange(run)}
        </strong>{' '}
        of API usage{onKey ? ' on your key' : ''} (typically about {formatTypicalCost(run)})
        {onKey
          ? ', billed to you by Anthropic.'
          : ', covered by the plan’s research sessions — never charged on top of the plan.'}
        {showSingleSession
          ? ` A policy analysis is ${sessionCount(analysis.sessions)} ≈ ${formatCostRange(analysis)}. ` +
            `Re-running one dimension is ${sessionCount(rerun.sessions)} ≈ ${formatCostRange(rerun)} ` +
            `(typically about ${formatTypicalCost(rerun)}): the region overview is researched again first, and both are paid for.`
          : ''}
      </p>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        An estimate from model limits and prompt sizes ({RESEARCH_COST_ESTIMATED_ON}), not a bill
        {onKey ? ' — your Anthropic Console shows what each run actually used' : ''}.
      </p>
    </div>
  );
}
