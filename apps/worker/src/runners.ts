import type { RunnerOptions } from 'graphile-worker';
import {
  APPLY_TASK,
  POLICY_SWEEP_CRONTAB,
  POLICY_SWEEP_TASK,
  POLICY_TASK,
  PRIVACY_SWEEP_CRONTAB,
  PRIVACY_SWEEP_TASK,
} from '@deep-fryer/research';
import { researchApply } from './tasks/research-apply.js';
import { policyAnalyze, policySweep } from './tasks/policy-analyze.js';
import { alertsRunnerOptions } from './tasks/alerts-sync.js';
import { privacySweep } from './tasks/privacy-sweep.js';
export {
  DEFAULT_MAX_ACTIVE_SESSIONS,
  SessionSemaphore,
  getSharedSessionSemaphore,
  parseMaxActiveSessions,
  resetSharedSessionSemaphore,
} from './session-semaphore.js';

/** Default concurrency for the dedicated policy-analysis runner (P2.2). */
export const POLICY_RUNNER_CONCURRENCY = 2;

/**
 * The worker's four graphile-worker runners, as data so the wiring is
 * tested (runners.test.ts) rather than discovered in production.
 *
 * - The research runner executes portrait research runs (`research_apply`) at
 *   WORKER_CONCURRENCY, bounded globally alongside policy sessions by the
 *   shared `MAX_ACTIVE_SESSIONS` semaphore (default 6).
 * - The policy runner executes 90-second policy analyses (`policy_analyze`) at
 *   concurrency 2 plus the stuck-analysis sweep (`policy_sweep`), so policy
 *   scans never queue for 45 minutes behind a portrait build (P2.2).
 * - The alerts runner refreshes official NWS alerts every five minutes on its
 *   own slot (alerts-sync.ts), so a 40-minute research session never delays
 *   an alert.
 * - The housekeeping runner deletes expired sign-in records every quarter
 *   hour (tasks/privacy-sweep.ts) on a slot of its own too: the privacy
 *   notice promises that schedule, so it must not wait behind research, and
 *   a slow alert feed must not hold it either.
 *
 * A runner only claims jobs for the tasks it registers, so they never take
 * each other's work.
 */
export function researchRunnerOptions(connectionString: string, concurrency: number): RunnerOptions {
  return {
    connectionString,
    concurrency,
    taskList: {
      [APPLY_TASK]: researchApply,
    },
  };
}

export function policyRunnerOptions(
  connectionString: string,
  concurrency: number = POLICY_RUNNER_CONCURRENCY,
): RunnerOptions {
  return {
    connectionString,
    concurrency,
    taskList: {
      [POLICY_TASK]: policyAnalyze,
      [POLICY_SWEEP_TASK]: policySweep,
    },
    crontab: POLICY_SWEEP_CRONTAB,
  };
}

export function housekeepingRunnerOptions(connectionString: string): RunnerOptions {
  return {
    connectionString,
    concurrency: 1,
    taskList: { [PRIVACY_SWEEP_TASK]: privacySweep },
    crontab: PRIVACY_SWEEP_CRONTAB,
  };
}

export function workerRunners(
  connectionString: string,
  concurrency: number,
  policyConcurrency: number = POLICY_RUNNER_CONCURRENCY,
): RunnerOptions[] {
  return [
    researchRunnerOptions(connectionString, concurrency),
    policyRunnerOptions(connectionString, policyConcurrency),
    alertsRunnerOptions(connectionString),
    housekeepingRunnerOptions(connectionString),
  ];
}
