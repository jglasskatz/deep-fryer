import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DbExecutor } from '@deep-fryer/db';

/**
 * The health check every start and restore check trusts (docs/deploy.md §3,
 * §6): healthy only when a visitor's query works, not merely when Postgres
 * answers the owner. Runs against real Postgres.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// The route's connection, swappable for one transaction the test controls.
const override = vi.hoisted(() => ({ db: null as DbExecutor | null }));
vi.mock('@/lib/db', async () => {
  const { getDb } = await import('@deep-fryer/db');
  return { systemDb: () => override.db ?? getDb() };
});

class Rollback extends Error {}

describe.skipIf(!hasDb)('GET /api/health', () => {
  it('is 200 when the app role can read portraits', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('is 503 when Postgres answers but the app role has lost its grants, as after a restore without the roles', async () => {
    const { getDb } = await import('@deep-fryer/db');
    const { GET } = await import('./route');
    // The lost grant exists only inside this transaction, which is rolled
    // back, so no other connection (or test file) ever sees it. The route's
    // own transaction nests in it as a savepoint.
    let res: Response | undefined;
    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql`revoke select on tenants from deep_fryer_app`);
        // The owner connection still answers: the old `select 1` probe said healthy here.
        await tx.execute(sql`select 1`);
        override.db = tx;
        try {
          res = await GET();
        } finally {
          override.db = null;
        }
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect(res!.status).toBe(503);
    expect(await res!.json()).toEqual({ ok: false });
  });
});
