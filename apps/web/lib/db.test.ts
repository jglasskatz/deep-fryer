import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDb = Boolean(process.env.DATABASE_URL);
const USER = '11111111-2222-4333-8444-555555555555';

// A signed-in person (not dev mode): userDb must run as the enforced role.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, email: 'x@example.gov', displayName: null, isStaff: false } })),
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
});
