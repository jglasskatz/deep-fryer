import { quickAddJob } from 'graphile-worker';

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

/** Policy analysis (SPEC-v5 §2): one worker session per analysis. */
export const POLICY_TASK = 'policy_analyze';

export interface PolicyJobPayload {
  analysisId: string;
}

export async function enqueuePolicyAnalysis(analysisId: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  await quickAddJob({ connectionString }, POLICY_TASK, { analysisId } satisfies PolicyJobPayload, {
    jobKey: `policy:${analysisId}`,
  });
}

/**
 * Official alerts (SPEC-v5 §3): the worker refreshes every portrait with NWS
 * zones configured on this schedule (graphile-worker crontab syntax).
 */
export const ALERTS_TASK = 'alerts_sync';
export const ALERTS_CRONTAB = `*/5 * * * * ${ALERTS_TASK}`;
