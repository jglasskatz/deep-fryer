import { priceSessionUsage } from './model-pricing.js';
import type { ContentSupported, RunTokenUsage, SessionTokenUsage } from './types.js';

export type CostCoverage = 'complete' | 'partial' | 'unavailable';

/**
 * The stage a usage record paid for. Region context is the run's opening
 * session that describes the place; research is a dimension's own session;
 * verification is the independent check of that session's findings; audit
 * is a machine audit of one finding after the run.
 */
export type CostStage = 'region_context' | 'research' | 'verification' | 'audit';

export interface SessionCostSummary {
  session: string;
  role: CostStage;
  /** The dimension this record's dollars belong to; null for region context or when it cannot be matched. */
  dimension_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  known_estimated_usd: number;
  coverage: Exclude<CostCoverage, 'unavailable'>;
  unpriced_models: string[];
  limitations: string[];
}

/** One dimension's share of a run: its own sessions, their verifiers and the audits of its findings. */
export interface DimensionCostSummary {
  dimension_id: string;
  research_estimated_usd: number;
  verification_estimated_usd: number;
  audit_estimated_usd: number;
  known_estimated_usd: number;
  /** Partial when a session of this dimension has no record or a record that is not fully priced. */
  coverage: Exclude<CostCoverage, 'unavailable'>;
  unpriced_models: string[];
  verified_findings: number;
  /** Null when nothing verified or this dimension's dollars are not fully known. */
  cost_per_verified_finding_usd: number | null;
}

/**
 * What a run's rows say about where each usage record belongs: the run's
 * sessions (kind and dimension) and its findings (dimension and verdict).
 * The shape matches the rows apps/web runWithSessions reads.
 */
export interface RunCostContext {
  sessions: readonly { id: string; kind: string; dimensionId: string | null }[];
  findings: readonly {
    id: string;
    dimensionId: string;
    payload: { kind: string };
    verification: { content_supported: ContentSupported } | null;
  }[];
}

type ContextSession = RunCostContext['sessions'][number];
type ContextFinding = RunCostContext['findings'][number];

const AUDIT_KEY = /^audit:[^:]+:(.+)$/;

/** A finding counts as verified when it is a measurement the independent verifier passed. */
function isVerified(finding: ContextFinding): boolean {
  return finding.payload.kind === 'indicator' && finding.verification?.content_supported === 'pass';
}

/**
 * Where one usage record's dollars go. Keys are written by the worker: a
 * session's own id, `correction:<session id>` for a pre-verifier self-correction
 * pass, `escalation:<session id>` for a hybrid escalation pass,
 * `verifier:<session id>` for that session's verifier calls, and
 * `audit:<source>:<finding id>` for a machine audit. Without a context the
 * stage is read from the key alone and nothing is matched to a dimension.
 */
function placeRecord(
  key: string,
  sessions: Map<string, ContextSession>,
  findings: Map<string, ContextFinding>,
): { role: CostStage; dimension_id: string | null } {
  const audit = AUDIT_KEY.exec(key);
  if (audit) return { role: 'audit', dimension_id: findings.get(audit[1]!)?.dimensionId ?? null };
  if (key.startsWith('audit:')) return { role: 'audit', dimension_id: null };
  if (key.startsWith('verifier:')) {
    return { role: 'verification', dimension_id: sessions.get(key.slice('verifier:'.length))?.dimensionId ?? null };
  }
  if (key.startsWith('triage:')) {
    return { role: 'verification', dimension_id: sessions.get(key.slice('triage:'.length))?.dimensionId ?? null };
  }
  if (key.startsWith('correction:')) {
    return { role: 'research', dimension_id: sessions.get(key.slice('correction:'.length))?.dimensionId ?? null };
  }
  if (key.startsWith('escalation:')) {
    return { role: 'research', dimension_id: sessions.get(key.slice('escalation:'.length))?.dimensionId ?? null };
  }
  const session = sessions.get(key);
  if (session?.kind === 'region_context') return { role: 'region_context', dimension_id: null };
  return { role: 'research', dimension_id: session?.dimensionId ?? null };
}

/**
 * A verifier record of nothing at all: the empty accumulator the worker
 * files under `verifier:<id>` for a session whose findings needed no
 * verifier (only gaps, say). It names no model and no tokens, so it is not a
 * legacy record hiding side calls. A session's own record is never read this
 * way: an empty main-loop record from an older worker still says nothing
 * about the side calls it left out, so it stays partial.
 */
function recordsNothing(key: string, entry: SessionTokenUsage): boolean {
  return (key.startsWith('verifier:') || key.startsWith('triage:')) && !entry.by_model && !entry.model
    && entry.input_tokens === 0 && entry.output_tokens === 0
    && !entry.cache_read_tokens && !entry.cache_write_tokens;
}

const sumUsd = (rows: readonly { known_estimated_usd: number }[]) => rows.reduce((n, s) => n + s.known_estimated_usd, 0);

/**
 * Price recorded usage with the same meter used by the strategy evaluator.
 * Missing telemetry is never converted into a zero-dollar completed run.
 * Main-loop-only legacy records remain partial because they omit side calls.
 *
 * Pass the run's sessions and findings (or, as before, only the expected
 * session ids) to split the dollars by stage and by dimension and to price
 * each verified finding. Dimension rows, region context and anything not
 * matched to a dimension add up to the run's known subtotal. A cost per
 * verified finding exists only when every dollar behind it is known: a
 * partial meter divided by a count would look exact and be too low.
 */
export function summarizeRunCosts(
  usage: RunTokenUsage | null | undefined,
  expected: readonly string[] | RunCostContext = [],
) {
  const context = isContext(expected) ? expected : null;
  const expectedSessionIds = context ? context.sessions.map((s) => s.id) : (expected as readonly string[]);
  const contextSessions = context?.sessions ?? [];
  const contextFindings = context?.findings ?? [];
  const sessionById = new Map(contextSessions.map((s) => [s.id, s]));
  const findingById = new Map(contextFindings.map((f) => [f.id, f]));

  const sessions: SessionCostSummary[] = Object.entries(usage ?? {}).map(([session, entry]) => {
    const priced = priceSessionUsage(entry);
    const limitations: string[] = [];
    if (entry.partial) limitations.push('Interrupted attempt; side-call usage may be missing.');
    if (!entry.by_model && !recordsNothing(session, entry)) limitations.push('Legacy main-loop accounting; other model calls are not fully recorded.');
    if (priced.unpriced.length) limitations.push('The rate table does not price every recorded model.');
    const totals = entry.by_model ? Object.values(entry.by_model) : [entry];
    const sum = (field: keyof Pick<SessionTokenUsage, 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>) =>
      totals.reduce((n, value) => n + (value[field] ?? 0), 0);
    if (entry.by_model && totals.length === 0 && (entry.input_tokens > 0 || entry.output_tokens > 0)) {
      limitations.push('Per-model telemetry is empty despite recorded main-loop usage.');
    }
    return {
      session,
      ...placeRecord(session, sessionById, findingById),
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
  const known = sumUsd(sessions);
  const stageTotal = (stage: CostStage) => (sessions.length ? sumUsd(sessions.filter((s) => s.role === stage)) : null);

  // Dimensions in the order the run's sessions list them, then any that
  // only an audit or verifier record names.
  const dimensionOrder = [...new Set([
    ...contextSessions.flatMap((s) => (s.kind === 'region_context' || !s.dimensionId ? [] : [s.dimensionId])),
    ...sessions.flatMap((s) => (s.dimension_id ? [s.dimension_id] : [])),
  ])];
  const missing = new Set(missingSessions);
  const dimensions: DimensionCostSummary[] = dimensionOrder.map((dimensionId) => {
    const own = sessions.filter((s) => s.dimension_id === dimensionId);
    const unrecorded = contextSessions.some((s) => s.dimensionId === dimensionId && missing.has(s.id));
    const dimCoverage = unrecorded || own.length === 0 || own.some((s) => s.coverage === 'partial') ? 'partial' : 'complete';
    const verified = contextFindings.filter((f) => f.dimensionId === dimensionId && isVerified(f)).length;
    const total = sumUsd(own);
    return {
      dimension_id: dimensionId,
      research_estimated_usd: sumUsd(own.filter((s) => s.role === 'research')),
      verification_estimated_usd: sumUsd(own.filter((s) => s.role === 'verification')),
      audit_estimated_usd: sumUsd(own.filter((s) => s.role === 'audit')),
      known_estimated_usd: total,
      coverage: dimCoverage,
      unpriced_models: [...new Set(own.flatMap((s) => s.unpriced_models))].sort(),
      verified_findings: verified,
      cost_per_verified_finding_usd: dimCoverage === 'complete' && verified > 0 ? total / verified : null,
    };
  });
  const unattributed = sessions.filter((s) => s.role !== 'region_context' && s.dimension_id === null);
  const verifiedFindings = contextFindings.filter(isVerified).length;

  return {
    currency: 'USD' as const,
    basis: 'Recorded usage priced using the repository rate table; an estimate, not a billed amount.',
    coverage,
    estimated_usd: coverage === 'complete' ? known : null,
    known_estimated_usd: sessions.length ? known : null,
    actual_billed_usd: null,
    region_context_estimated_usd: stageTotal('region_context'),
    research_estimated_usd: stageTotal('research'),
    verification_estimated_usd: stageTotal('verification'),
    audit_estimated_usd: stageTotal('audit'),
    /** Records that are not region context and match no dimension (no context given, or an unknown session or finding). */
    unattributed_estimated_usd: unattributed.length ? sumUsd(unattributed) : null,
    /** Findings the verifier passed; null when the run's findings were not given. */
    verified_findings: context ? verifiedFindings : null,
    /** The run's dollars over its verified findings: null unless every dollar is known and something verified. */
    cost_per_verified_finding_usd: coverage === 'complete' && verifiedFindings > 0 ? known / verifiedFindings : null,
    dimensions,
    unpriced_models: [...new Set(sessions.flatMap((s) => s.unpriced_models))].sort(),
    missing_sessions: missingSessions,
    sessions,
  };
}

function isContext(value: readonly string[] | RunCostContext): value is RunCostContext {
  return !Array.isArray(value);
}

export type RunCostSummary = ReturnType<typeof summarizeRunCosts>;

/**
 * Every run of a portrait that spent anything, added up: each applied run,
 * and any run that recorded usage without being applied (a measurement run
 * started by staff is worked without being applied, yet still spends). Only
 * a plan that neither was applied nor recorded usage is left out, so the
 * total agrees with the dollars the run list shows run by run. A counted
 * run whose usage is missing or not fully priced leaves the total unknown
 * and is counted in `runs_incomplete`, while its known dollars still join
 * the subtotal. `sessionIds` are the run's session rows, so a session that
 * left no record makes its run incomplete here just as on the run's own page.
 */
export function summarizePortraitCosts(
  runs: readonly {
    appliedAt: Date | string | null;
    tokenUsage: RunTokenUsage | null | undefined;
    sessionIds?: readonly string[];
  }[],
) {
  const counted = runs.filter((run) => run.appliedAt !== null || Object.keys(run.tokenUsage ?? {}).length > 0);
  const summaries = counted.map((run) => summarizeRunCosts(run.tokenUsage, run.sessionIds ?? []));
  const known = summaries.reduce((n, s) => n + (s.known_estimated_usd ?? 0), 0);
  const incomplete = summaries.filter((s) => s.coverage !== 'complete').length;
  return {
    currency: 'USD' as const,
    runs_counted: counted.length,
    runs_incomplete: incomplete,
    known_estimated_usd: known,
    estimated_usd: incomplete === 0 ? known : null,
  };
}

export type PortraitCostSummary = ReturnType<typeof summarizePortraitCosts>;
