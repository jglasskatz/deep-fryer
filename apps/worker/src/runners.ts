import type { RunnerOptions } from 'graphile-worker';
import { APPLY_TASK, POLICY_SWEEP_CRONTAB, POLICY_SWEEP_TASK, POLICY_TASK } from '@deep-fryer/research';
import { researchApply } from './tasks/research-apply.js';
import { policyAnalyze, policySweep } from './tasks/policy-analyze.js';
import { alertsRunnerOptions } from './tasks/alerts-sync.js';

/**
 * The worker's two graphile-worker runners, as data so the wiring is tested
 * (runners.test.ts) rather than discovered in production.
 *
 * - The research runner executes model sessions — research runs and policy
 *   analyses — at WORKER_CONCURRENCY, plus the sweep that settles analyses
 *   whose worker died mid-session.
 * - The alerts runner refreshes official NWS alerts every five minutes on its
 *   own slot (alerts-sync.ts), so a 40-minute research session never delays
 *   an alert. A runner only claims jobs for the tasks it registers, so the
 *   two never take each other's work.
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

export function workerRunners(connectionString: string, concurrency: number): RunnerOptions[] {
  return [researchRunnerOptions(connectionString, concurrency), alertsRunnerOptions(connectionString)];
}
