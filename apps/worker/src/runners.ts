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

/**
 * The worker's three graphile-worker runners, as data so the wiring is
 * tested (runners.test.ts) rather than discovered in production.
 *
 * - The research runner executes model sessions — research runs and policy
 *   analyses — at WORKER_CONCURRENCY, plus the sweep that settles analyses
 *   whose worker died mid-session.
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

export function workerRunners(connectionString: string, concurrency: number): RunnerOptions[] {
  return [
    researchRunnerOptions(connectionString, concurrency),
    alertsRunnerOptions(connectionString),
    housekeepingRunnerOptions(connectionString),
  ];
}
