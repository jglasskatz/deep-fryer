import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * getDb() keeps one pool per process. The Next.js web server loads this
 * module several times — its page, server-action and middleware bundles each
 * carry a copy — and a module-level cache gave each copy its own pool of
 * DATABASE_POOL_MAX connections: 30 connections per web process at the
 * default 10, three times what the sizing assumed. Here two copies are loaded
 * the way those bundles load them (separately, with their own module state)
 * and must hand out the same client. No query runs: postgres.js connects
 * lazily, so any URL will do.
 */
describe('getDb', () => {
  const savedUrl = process.env.DATABASE_URL;
  afterAll(async () => {
    const { DB_CLIENT_KEY } = await import('./client.js');
    const client = Reflect.get(globalThis, DB_CLIENT_KEY) as { $client: { end(): Promise<void> } } | undefined;
    Reflect.deleteProperty(globalThis, DB_CLIENT_KEY);
    await client?.$client.end();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('shares one client between separately loaded copies of the module', async () => {
    process.env.DATABASE_URL ??= 'postgres://localhost:5432/unused';
    const first = await import('./client.js');
    vi.resetModules();
    const second = await import('./client.js');
    // Two copies, each with its own module state, as in the web server's bundles.
    expect(second).not.toBe(first);
    const client = first.getDb();
    expect(second.getDb()).toBe(client);
    expect(Reflect.get(globalThis, second.DB_CLIENT_KEY)).toBe(client);
  });
});
