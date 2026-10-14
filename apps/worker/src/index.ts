import { run } from 'graphile-worker';
import { workerRunners } from './runners.js';

/**
 * The research-plane worker (SPEC.md §4, §8; SPEC-v5 §2–3): consumes the
 * Postgres-backed queue — research runs, policy analyses, and the official
 * alert refresh — on the runners described in runners.ts. The web app only
 * enqueues.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY is not set — research and policy sessions will fail at spawn.');
  }

  const runners = await Promise.all(
    workerRunners(connectionString, Number(process.env.WORKER_CONCURRENCY ?? 1)).map((options) => run(options)),
  );
  console.log('deep-fryer worker: listening for research, policy, and alert jobs');
  await Promise.all(runners.map((r) => r.promise));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
