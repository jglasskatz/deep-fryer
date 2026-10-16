import { vi } from 'vitest';

/**
 * For tests only: run a code path on a pool of exactly one connection, to
 * prove it never asks for a second pooled connection while its own
 * transaction holds one.
 *
 * Code that does — another userDb() transaction, or a systemDb() query,
 * inside a userDb() callback — deadlocks the pool once as many requests do it
 * at once as the pool has connections (DATABASE_POOL_MAX): each holds one and
 * waits for another that never frees. With one connection a single request
 * is enough, so the hang is deterministic: code that keeps to its own
 * transaction finishes, nested code waits until `ms` runs out and the test
 * fails.
 *
 * The modules `run` imports are loaded afresh (vi.resetModules) so they build
 * the one-connection pool; afterwards that pool is torn down — connections
 * and all, so a hung transaction cannot hold up the file's own cleanup — and
 * the registry is reset again, so later imports get the usual pool. Resolves
 * with what `run` resolves (or rejects with what it rejects), so callers can
 * assert on the result as well.
 */
export async function onOneConnection<T>(run: () => Promise<T>, ms = 3_000): Promise<T> {
  const saved = process.env.DATABASE_POOL_MAX;
  vi.resetModules();
  process.env.DATABASE_POOL_MAX = '1';
  const { getDb } = await import('@deep-fryer/db');
  // getDb() reads DATABASE_POOL_MAX once, when it first builds the pool: build
  // it now, then put the variable back for anything that builds one later.
  const db = getDb();
  if (saved === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = saved;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`still waiting after ${ms} ms: the code under test wants a second pooled connection`)),
      ms,
    );
  });
  const running = run();
  try {
    return await Promise.race([running, hung]);
  } finally {
    clearTimeout(timer);
    // timeout 0: close at once, ending a transaction that is still waiting.
    await db.$client.end({ timeout: 0 });
    // A run that hung fails once its connections are gone: let that happen
    // here, inside this test, not as a stray rejection blamed on the next.
    await running.catch(() => undefined);
    vi.resetModules();
  }
}
