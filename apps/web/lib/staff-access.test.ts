import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Staff access granted from the shell (packages/db setStaff, used by
 * scripts/make-staff.ts) reaches the signed-in person's next request: the
 * Auth.js adapter reads the flag with their database session, which is what
 * auth.ts's session callback copies, and getAuth() answers isStaff from it.
 * The session itself is not replaced, so nobody has to sign in again.
 */

let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('staff access set from the shell', () => {
  const saved = process.env.AUTH_SECRET;
  const userIds: string[] = [];

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    if (!userIds.length) return;
    const m = await import('@deep-fryer/db');
    const { and, inArray, isNull } = await import('drizzle-orm');
    const db = m.getDb();
    await db.delete(m.auditLog).where(and(isNull(m.auditLog.tenantId), inArray(m.auditLog.entityId, userIds)));
    // Sessions go with the account.
    await db.delete(m.users).where(inArray(m.users.id, userIds));
  });

  it('makes getAuth() say isStaff on the next request, and not after it is taken away', async () => {
    const m = await import('@deep-fryer/db');
    const { DrizzleAdapter } = await import('@auth/drizzle-adapter');
    const { getAuth } = await import('./auth');
    const db = m.getDb();

    // A person who has signed in with a sign-in link and holds a live session.
    const [user] = await db
      .insert(m.users)
      .values({ email: `${uniq()}@example.org`, emailVerified: new Date() })
      .returning();
    userIds.push(user!.id);
    const sessionToken = uniq();
    await db.insert(m.sessions).values({ sessionToken, userId: user!.id, expires: new Date(Date.now() + 86_400_000) });
    const adapter = DrizzleAdapter(db, {
      usersTable: m.users,
      accountsTable: m.accounts,
      sessionsTable: m.sessions,
      verificationTokensTable: m.verificationTokens,
    });
    const sessionUser = async () =>
      (await adapter.getSessionAndUser!(sessionToken))?.user as { isStaff?: boolean } | undefined;
    signedIn = user!.id;

    expect(await getAuth()).toMatchObject({ userId: user!.id, isStaff: false, devMode: false });

    await m.setStaff(db, user!.email!, true);
    expect((await sessionUser())?.isStaff).toBe(true);
    expect(await getAuth()).toMatchObject({ userId: user!.id, isStaff: true });

    await m.setStaff(db, user!.email!, false);
    expect((await sessionUser())?.isStaff).toBe(false);
    expect(await getAuth()).toMatchObject({ userId: user!.id, isStaff: false });
  });
});
