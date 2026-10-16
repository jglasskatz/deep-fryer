import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { onOneConnection } from '../test/one-connection';

const hasDb = Boolean(process.env.DATABASE_URL);
const USER = '11111111-2222-4333-8444-555555555555';

// A signed-in person (not dev mode): userDb must run as the enforced role.
// Reading the session costs a query on the pooled client, as Auth.js's
// database sessions do in production; `sessionReads` counts them.
const sessionReads = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => {
    sessionReads.n++;
    const { getDb } = await import('@deep-fryer/db');
    const { sql: q } = await import('drizzle-orm');
    await getDb().execute(q`select 1`);
    return { user: { id: USER, email: 'x@example.gov', displayName: null, isStaff: false } };
  }),
}));

describe.skipIf(!hasDb)('userDb wiring', () => {
  it('runs user work as deep_fryer_app with app.user_id set, and system work as owner', async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const { userDb, systemDb } = await import('./db');
    const rows = await userDb((db) =>
      db.execute<{ role: string; uid: string | null }>(sql`select current_user as role, auth.uid()::text as uid`),
    );
    expect(rows[0]).toEqual({ role: 'deep_fryer_app', uid: USER });
    const sys = await systemDb().execute<{ role: string }>(sql`select current_user as role`);
    expect(sys[0]!.role).not.toBe('deep_fryer_app');
    // The role switch is transaction-scoped: it never leaks back into the pool.
    const after = await systemDb().execute<{ uid: string | null }>(sql`select auth.uid()::text as uid`);
    expect(after[0]!.uid).toBeNull();
    delete process.env.AUTH_SECRET;
  });

  it('answers the identity inside its transactions with the one they were opened as, without reading the session again', async () => {
    // getAuth() inside a transaction — audit()'s actor, requireUserId() —
    // used to read the session again, on a second pooled connection while
    // the transaction held the first: on a one-connection pool, one request
    // waited forever (test/one-connection.ts).
    process.env.AUTH_SECRET = 'test-secret';
    try {
      const inside = await onOneConnection(async () => {
        const { userDb, systemTransaction } = await import('./db');
        const { getAuth, requireUserId } = await import('./auth');
        const before = sessionReads.n;
        const asUser = await userDb(async (db) => {
          const [row] = await db.execute<{ uid: string }>(sql`select auth.uid()::text as uid`);
          return { uid: row!.uid, auth: (await getAuth()).userId, required: await requireUserId() };
        });
        const asSystem = await systemTransaction(async (tx) => {
          const [row] = await tx.execute<{ role: string }>(sql`select current_user as role`);
          return { role: row!.role, auth: (await getAuth()).userId };
        });
        // One read each, before its transaction opened.
        const reads = sessionReads.n - before;
        // Outside a transaction nothing is held: the next call reads afresh.
        await getAuth();
        return { asUser, asSystem, reads, readsAfter: sessionReads.n - before };
      });
      expect(inside.asUser).toEqual({ uid: USER, auth: USER, required: USER });
      expect(inside.asSystem.auth).toBe(USER);
      expect(inside.asSystem.role).not.toBe('deep_fryer_app');
      expect(inside.reads).toBe(2);
      expect(inside.readsAfter).toBe(3);
    } finally {
      delete process.env.AUTH_SECRET;
    }
  });
});
