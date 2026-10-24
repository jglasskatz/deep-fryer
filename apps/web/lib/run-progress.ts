import type { PlannedSession } from '@deep-fryer/core';

/**
 * Where a research run stands, as its run page shows it (SPEC.md §8) — pure,
 * so the page, the runs list and the tests read one set of rules.
 *
 * The database has four run statuses, but staff need five states: a run is
 * `planned` both before anyone applied it and after applyRun handed it to
 * the queue but before the worker claimed it (apps/worker research-apply.ts
 * moves planned → running atomically on claim). applyRun stamps applied_at
 * in the same step as the billing gate, so `planned` with applied_at set is
 * a run that is queued: it must never offer "Apply" again, and the page
 * should say it is about to start rather than that it waits for a click.
 */
export type RunPhase = 'unapplied' | 'queued' | 'running' | 'complete' | 'failed';

export function runPhase(run: { status: string; appliedAt: Date | null }): RunPhase {
  if (run.status === 'planned') return run.appliedAt ? 'queued' : 'unapplied';
  if (run.status === 'running') return 'running';
  if (run.status === 'complete') return 'complete';
  return 'failed';
}

/** The run page and the runs list refresh themselves while a run can still change. */
export const runInProgress = (phase: RunPhase): boolean => phase === 'queued' || phase === 'running';

/** The word staff see for a run's state (the runs list badge, the run page heading). */
export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  unapplied: 'planned',
  queued: 'queued',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
};

/**
 * What applyRun says when asked to apply a run that already was. Clicking
 * "Apply" on a page opened before the run was applied (another tab, a
 * second editor) lands here; the database status is not something staff
 * should have to read ("already applied (status: planned)" meant "queued").
 * Every case says what is happening instead, and that nothing ran twice.
 */
export function alreadyAppliedMessage(run: { status: string; appliedAt: Date | null }): string {
  switch (runPhase(run)) {
    case 'queued':
      return 'This run was already applied and is queued — it starts shortly. Nothing was started twice; reload the page to follow its progress.';
    case 'running':
      return 'This run was already applied and is running now. Nothing was started twice; reload the page to follow its progress.';
    case 'complete':
      return 'This run already finished. Its findings are in the review queue; plan a new run to research again.';
    case 'failed':
      return 'This run already ran and stopped with failures. Its run page says why; plan a new run to try again.';
    case 'unapplied':
      // Not reachable through applyRun (an unapplied run is applied), kept total for the type.
      return 'This run has not been applied yet.';
  }
}

/**
 * A planned session's state on the run page. The worker inserts a session
 * row only when that session starts (research-apply.ts), so a planned
 * session with no row is still waiting while the run is queued or running —
 * and, once the run has settled, never ran (a dimension the worker could not
 * find, or a run stopped part-way by an error).
 */
export type SessionChip = 'queued' | 'running' | 'done' | 'failed' | 'not_run';

export const SESSION_CHIP_LABEL: Record<SessionChip, string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  not_run: 'did not run',
};

/** The research_sessions columns the progress view reads (the app role cannot read transcripts). */
export interface SessionRow {
  id: string;
  kind: string;
  dimensionId: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface PlannedSessionProgress {
  /** 'region_context' or the dimension's slug: how a plan entry and its session row are matched. */
  key: string;
  spec: PlannedSession;
  session: SessionRow | null;
  chip: SessionChip;
}

export interface RunProgress {
  items: PlannedSessionProgress[];
  total: number;
  /** Sessions that reached an end, either way ("n of N sessions finished"). */
  finished: number;
  done: number;
  failed: number;
  running: number;
  queued: number;
  notRun: number;
}

const specKey = (spec: PlannedSession): string =>
  spec.kind === 'region_context' ? 'region_context' : (spec.dimension_slug ?? '');

/**
 * Pure: every planned session with its row (if it started) and its chip,
 * plus the counts the page summarizes. Rows are matched to the plan by
 * dimension (slugById maps a row's dimension id to the slug the plan names),
 * the region-context session by kind. Dense dimensions have several rows:
 * consume each once in start order, so one finished part cannot make every
 * part appear finished. These historic rows carry no chunk identifier, so
 * progress labels the dimension rather than claiming a particular chunk.
 */
export function runProgress(
  specs: readonly PlannedSession[],
  sessions: readonly SessionRow[],
  slugById: ReadonlyMap<string, string>,
  phase: RunPhase,
): RunProgress {
  const rowsByKey = new Map<string, SessionRow[]>();
  for (const session of [...sessions].sort((a, b) =>
    (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))) {
    const key = session.kind === 'region_context' ? 'region_context' : (slugById.get(session.dimensionId ?? '') ?? '');
    const rows = rowsByKey.get(key) ?? [];
    rows.push(session);
    rowsByKey.set(key, rows);
  }
  const settled = phase === 'complete' || phase === 'failed';
  const items = specs.map((spec): PlannedSessionProgress => {
    const key = specKey(spec);
    const session = rowsByKey.get(key)?.shift() ?? null;
    let chip: SessionChip;
    if (!session) chip = settled ? 'not_run' : 'queued';
    else if (session.status === 'complete') chip = 'done';
    else if (session.status === 'failed') chip = 'failed';
    else if (session.status === 'running') chip = settled ? 'failed' : 'running';
    else chip = settled ? 'not_run' : 'queued';
    return { key, spec, session, chip };
  });
  const count = (chip: SessionChip) => items.filter((i) => i.chip === chip).length;
  const done = count('done');
  const failed = count('failed');
  return {
    items,
    total: items.length,
    finished: done + failed,
    done,
    failed,
    running: count('running'),
    queued: count('queued'),
    notRun: count('not_run'),
  };
}

/**
 * How many dimension sessions must have finished before the page offers an
 * estimate. The worker runs dimension sessions a few at a time
 * (RESEARCH_SESSION_CONCURRENCY, 3 by default), so the first ones finish
 * together; fewer than a full batch would measure one session's length, not
 * the run's pace, and overstate what is left.
 */
export const MIN_FINISHED_FOR_ESTIMATE = 3;

/**
 * Pure: about how long the rest of a running run will take at the pace this
 * run's own dimension sessions have kept so far — never a figure from
 * anywhere else. The pace is the wall-clock time since the first dimension
 * session started divided by how many have finished, which already reflects
 * however many the worker runs at once; the estimate is that pace times the
 * dimension sessions still to finish. Null until MIN_FINISHED_FOR_ESTIMATE
 * have finished, when nothing is left, or when the run is not running: the
 * page then shows no estimate rather than a guess.
 */
export function remainingEstimateMs(progress: RunProgress, phase: RunPhase, now: Date): number | null {
  if (phase !== 'running') return null;
  const dims = progress.items.filter((i) => i.spec.kind === 'dimension');
  const finished = dims.filter((i) => i.chip === 'done' || i.chip === 'failed');
  if (finished.length < MIN_FINISHED_FOR_ESTIMATE) return null;
  const left = dims.length - finished.length;
  if (left <= 0) return null;
  const starts = dims.flatMap((i) => (i.session?.startedAt ? [i.session.startedAt.getTime()] : []));
  if (starts.length === 0) return null;
  const elapsed = now.getTime() - Math.min(...starts);
  if (elapsed <= 0) return null;
  return Math.round((elapsed / finished.length) * left);
}

/** How long a finished session took, or null when its row lacks either end. */
export function sessionDurationMs(session: SessionRow | null): number | null {
  if (!session?.startedAt || !session.completedAt) return null;
  return Math.max(0, session.completedAt.getTime() - session.startedAt.getTime());
}

/**
 * Pure: a duration in words for staff ("under a minute", "12 minutes",
 * "1 hour 5 minutes"). Minutes are the finest unit worth reading on a page
 * that refreshes every few seconds; an estimate is rounded the same way.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} minute${rest === 1 ? '' : 's'}` : h;
}

/**
 * A queued run is normally claimed within seconds. Past this the page stops
 * saying "starting shortly" and says why it may be waiting: the worker takes
 * runs one after another (WORKER_CONCURRENCY, 1 by default), so a run applied
 * while another portrait's run is under way waits for that one to finish.
 */
export const LONG_QUEUE_MS = 10 * 60_000;
