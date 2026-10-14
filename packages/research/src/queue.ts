import { quickAddJob, runMigrations } from 'graphile-worker';

export const APPLY_TASK = 'research_apply';

export interface ApplyJobPayload {
  runId: string;
}

/** Enqueue a run for the worker (SPEC.md §8 Apply). The web app calls this. */
export async function enqueueResearchApply(runId: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // jobKey dedupes concurrent applies of the same run: two racing POSTs
  // collapse to one job instead of two workers executing the same plan.
  await quickAddJob({ connectionString }, APPLY_TASK, { runId } satisfies ApplyJobPayload, {
    jobKey: runId,
  });
}

/**
 * Policy analysis (SPEC-v5 §2): one worker session per analysis.
 *
 * Unlike research runs, an analysis is enqueued INSIDE the transaction that
 * creates its row (apps/web/lib/policy-actions.ts calls graphile-worker's
 * SQL `add_job` on the same connection): the row, its reserved research
 * session, and its job commit or roll back together, so no crash or queue
 * outage between two separate writes can leave a billed analysis that no
 * worker will ever pick up. That needs graphile-worker's schema to exist
 * before the transaction starts — see ensureJobQueueSchema.
 */
export const POLICY_TASK = 'policy_analyze';

export interface PolicyJobPayload {
  analysisId: string;
}

/** One job per analysis, however often it is enqueued (graphile-worker job_key). */
export function policyJobKey(analysisId: string): string {
  return `policy:${analysisId}`;
}

let jobQueueSchema: Promise<void> | null = null;

/**
 * Install (or confirm) graphile-worker's schema, once per process. The
 * worker does this at start-up and quickAddJob does it on every call, but a
 * caller that enqueues with SQL inside its own transaction does neither, and
 * on a fresh deployment the web app can take the first analysis before the
 * worker has ever started. Idempotent and safe alongside a running worker
 * (graphile-worker serializes its migrations with an advisory lock). A
 * failure is not cached, so the next call tries again.
 */
export function ensureJobQueueSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return Promise.reject(new Error('DATABASE_URL is not set'));
  jobQueueSchema ??= runMigrations({ connectionString }).catch((err: unknown) => {
    jobQueueSchema = null;
    throw err;
  });
  return jobQueueSchema;
}

/**
 * The policy-analysis safety net (SPEC-v5 §2): every few minutes the worker
 * settles analyses that have sat `queued` for a long time with no job that
 * could still run them (the job was removed, or failed permanently) — as
 * failed, so the reserved research session is released, and tells the
 * requester. An analysis whose job is merely waiting (the worker is down or
 * busy) is left alone: it will still run.
 */
export const POLICY_SWEEP_TASK = 'policy_sweep';
export const POLICY_SWEEP_CRONTAB = `*/10 * * * * ${POLICY_SWEEP_TASK}`;

/**
 * Official alerts (SPEC-v5 §3): the worker refreshes every portrait with NWS
 * zones configured on this schedule (graphile-worker crontab syntax).
 *
 * `max=1`: a failed tick is not retried — the next tick five minutes later
 * is the retry, and backed-off retries of old ticks would only compete with
 * it. `jobKey`: one pending tick at a time; a tick that finds the previous
 * one still waiting (the runner busy) replaces it instead of queueing
 * behind it, and replaces a permanently failed one too.
 */
export const ALERTS_TASK = 'alerts_sync';
export const ALERTS_CRONTAB = `*/5 * * * * ${ALERTS_TASK} ?max=1&jobKey=${ALERTS_TASK}`;
