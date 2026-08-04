import { quickAddJob } from 'graphile-worker';

export const APPLY_TASK = 'research_apply';

export interface ApplyJobPayload {
  runId: string;
}

/** Enqueue a run for the worker (SPEC.md §8 Apply). The web app calls this. */
export async function enqueueResearchApply(runId: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  await quickAddJob({ connectionString }, APPLY_TASK, { runId } satisfies ApplyJobPayload);
}
