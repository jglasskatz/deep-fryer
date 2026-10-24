import { priceSessionUsage } from './model-pricing.js';
import type { RunTokenUsage, SessionTokenUsage } from './types.js';

export type CostCoverage = 'complete' | 'partial' | 'unavailable';

export interface SessionCostSummary {
  session: string;
  role: 'research' | 'verification' | 'audit';
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  known_estimated_usd: number;
  coverage: Exclude<CostCoverage, 'unavailable'>;
  unpriced_models: string[];
  limitations: string[];
}

/** Price recorded usage with the same meter used by the strategy evaluator.
 * Missing telemetry is never converted into a zero-dollar completed run.
 * Main-loop-only legacy records remain partial because they omit side calls.
 */
export function summarizeRunCosts(
  usage: RunTokenUsage | null | undefined,
  expectedSessionIds: readonly string[] = [],
) {
  const sessions: SessionCostSummary[] = Object.entries(usage ?? {}).map(([session, entry]) => {
    const priced = priceSessionUsage(entry);
    const limitations: string[] = [];
    if (entry.partial) limitations.push('Interrupted attempt; side-call usage may be missing.');
    if (!entry.by_model) limitations.push('Legacy main-loop accounting; other model calls are not fully recorded.');
    if (priced.unpriced.length) limitations.push('The rate table does not price every recorded model.');
    const totals = entry.by_model ? Object.values(entry.by_model) : [entry];
    const sum = (field: keyof Pick<SessionTokenUsage, 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>) =>
      totals.reduce((n, value) => n + (value[field] ?? 0), 0);
    if (entry.by_model && totals.length === 0 && (entry.input_tokens > 0 || entry.output_tokens > 0)) {
      limitations.push('Per-model telemetry is empty despite recorded main-loop usage.');
    }
    return {
      session,
      role: session.startsWith('audit:') ? 'audit' : session.startsWith('verifier:') ? 'verification' : 'research',
      input_tokens: sum('input_tokens'),
      output_tokens: sum('output_tokens'),
      cache_read_tokens: sum('cache_read_tokens'),
      cache_write_tokens: sum('cache_write_tokens'),
      known_estimated_usd: priced.dollars,
      coverage: limitations.length ? 'partial' : 'complete',
      unpriced_models: priced.unpriced,
      limitations,
    };
  });
  const missingSessions = [...new Set(expectedSessionIds)].filter((id) => !Object.hasOwn(usage ?? {}, id));
  const coverage: CostCoverage = sessions.length === 0 ? 'unavailable'
    : missingSessions.length || sessions.some((s) => s.coverage === 'partial') ? 'partial' : 'complete';
  const known = sessions.reduce((n, s) => n + s.known_estimated_usd, 0);
  return {
    currency: 'USD' as const,
    basis: 'Recorded usage priced using the repository rate table; an estimate, not a billed amount.',
    coverage,
    estimated_usd: coverage === 'complete' ? known : null,
    known_estimated_usd: sessions.length ? known : null,
    actual_billed_usd: null,
    research_estimated_usd: sessions.length ? sessions.filter((s) => s.role === 'research').reduce((n, s) => n + s.known_estimated_usd, 0) : null,
    verification_estimated_usd: sessions.length ? sessions.filter((s) => s.role === 'verification').reduce((n, s) => n + s.known_estimated_usd, 0) : null,
    audit_estimated_usd: sessions.length ? sessions.filter((s) => s.role === 'audit').reduce((n, s) => n + s.known_estimated_usd, 0) : null,
    unpriced_models: [...new Set(sessions.flatMap((s) => s.unpriced_models))].sort(),
    missing_sessions: missingSessions,
    sessions,
  };
}

export type RunCostSummary = ReturnType<typeof summarizeRunCosts>;
