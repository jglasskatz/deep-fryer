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
 * getDb() keeps one client per process on globalThis (packages/db
 * client.ts, DB_CLIENT_KEY), shared by every loaded copy of the module, so
 * the usual client is set aside for the run and getDb() builds the
 * one-connection pool in its place; the modules `run` imports are also loaded
 * afresh (vi.resetModules), so no module-level state carries over.
 * Afterwards that pool is torn down — connections and all, so a hung
 * transaction cannot hold up the file's own cleanup — the usual client is put
 * back, and the registry is reset again. Resolves with what `run` resolves
 * (or rejects with what it rejects), so callers can assert on the result as
 * well.
 */
export async function onOneConnection<T>(run: () => Promise<T>, ms = 3_000): Promise<T> {
  const saved = process.env.DATABASE_POOL_MAX;
  vi.resetModules();
  process.env.DATABASE_POOL_MAX = '1';
  const { getDb, DB_CLIENT_KEY } = await import('@deep-fryer/db');
  // Without the usual client on globalThis, getDb() builds a new one; it reads
  // DATABASE_POOL_MAX once, when it builds the pool: build it now, then put
  // the variable back for anything that builds one later.
  const usual: unknown = Reflect.get(globalThis, DB_CLIENT_KEY);
  Reflect.deleteProperty(globalThis, DB_CLIENT_KEY);
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
    // The usual client goes back only now that the run has settled, so
    // nothing it left running reaches the usual pool. With none before, the
    // next getDb() builds one.
    if (usual === undefined) Reflect.deleteProperty(globalThis, DB_CLIENT_KEY);
    else Reflect.set(globalThis, DB_CLIENT_KEY, usual);
    vi.resetModules();
  }
}
