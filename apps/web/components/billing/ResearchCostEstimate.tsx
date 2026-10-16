import {
  RESEARCH_COST_ESTIMATED_ON,
  SESSIONS_PER_FULL_REFRESH,
  estimateRunCost,
  formatCostRange,
} from '@deep-fryer/core';

/**
 * The API-usage estimate for research (SPEC-v7 §4, docs/research-cost.md),
 * worded the way the spec quotes it: "about 22 sessions ≈ $20–80 of API
 * usage on your key". Used on the billing page next to the API key form and
 * on /start before "Build my doughnut", so both quote the same numbers from
 * @deep-fryer/core research-cost.
 */
export function ResearchCostEstimate({
  sessions = SESSIONS_PER_FULL_REFRESH,
  onKey,
  showSingleSession = false,
}: {
  sessions?: number;
  /** Whether the sessions would run on the organization's own key ("of API usage on your key"). */
  onKey: boolean;
  /** Also quote one session (a policy analysis or a one-dimension re-run). */
  showSingleSession?: boolean;
}) {
  const run = estimateRunCost(sessions);
  const one = estimateRunCost(1);
  const typical = Math.round(run.typicalUsd).toLocaleString('en-US');
  return (
    <div className="text-sm">
      <p>
        {sessions === SESSIONS_PER_FULL_REFRESH ? 'A full portrait is about ' : 'About '}
        <strong>
          {sessions} research sessions ≈ {formatCostRange(run)}
        </strong>{' '}
        of API usage{onKey ? ' on your key' : ''} (typically about ${typical}).
        {showSingleSession
          ? ` A policy analysis or a one-dimension re-run is one session ≈ ${formatCostRange(one)}.`
          : ''}
      </p>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        An estimate from model limits and prompt sizes ({RESEARCH_COST_ESTIMATED_ON}), not a bill
        {onKey ? ' — your Anthropic Console shows what each run actually used' : ''}.
      </p>
    </div>
  );
}
