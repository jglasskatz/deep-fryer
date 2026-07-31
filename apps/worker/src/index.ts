import { run } from 'graphile-worker';
import { APPLY_TASK } from '@deep-fryer/research';
import { researchApply } from './tasks/research-apply.js';

/**
 * The research-plane worker (SPEC.md §4, §8): consumes the Postgres-backed
 * queue and executes research runs via the Claude Agent SDK. Deployed on
 * Fly.io/Railway (see Dockerfile); the web app only enqueues.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY is not set — research sessions will fail at spawn.');
  }

  const runner = await run({
    connectionString,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    taskList: {
      [APPLY_TASK]: researchApply,
    },
  });

  console.log('deep-fryer worker: listening for research jobs');
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
