import { afterAll, describe, expect, it } from 'vitest';
import { withPostgresError } from './errors.js';

/**
 * Staff access from the operator's shell: setStaff gives it only to an
 * account someone has signed in with, takes it away again, records both in
 * audit_log as account entries that belong to no portrait, and changes
 * nothing for an address no one has used. Account entries stay out of reach
 * of the app role (migration 0023).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('staff access', () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (!userIds.length) return;
    const m = await import('./index.js');
    const { and, inArray, isNull } = await import('drizzle-orm');
    const db = m.getDb();
    // Account entries have no tenant to cascade from, so they go by hand.
    await db.delete(m.auditLog).where(and(isNull(m.auditLog.tenantId), inArray(m.auditLog.entityId, userIds)));
    await db.delete(m.users).where(inArray(m.users.id, userIds));
  });

  /** An account the way Auth.js leaves it after a sign-in: by link (verified address) or by provider. */
  async function signedInUser(how: 'link' | 'provider', email = `${uniq()}@example.org`) {
    const m = await import('./index.js');
    const db = m.getDb();
    const [user] = await db
      .insert(m.users)
      .values({ email, emailVerified: how === 'link' ? new Date() : null })
      .returning();
    userIds.push(user!.id);
    if (how === 'provider') {
      await db.insert(m.accounts).values({ userId: user!.id, type: 'oidc', provider: 'google', providerAccountId: uniq() });
    }
    return user!;
  }

  async function staffEntries(userId: string) {
    const m = await import('./index.js');
    const { and, asc, eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(and(eq(m.auditLog.entity, m.STAFF_AUDIT_ENTITY), eq(m.auditLog.entityId, userId)))
      .orderBy(asc(m.auditLog.id));
  }

  async function isStaff(userId: string) {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select({ isStaff: m.users.isStaff }).from(m.users).where(eq(m.users.id, userId));
    return row?.isStaff;
  }

  it('gives a signed-in account staff access and records it as an account entry with no portrait', async () => {
    const m = await import('./index.js');
    const user = await signedInUser('link');

    const result = await m.setStaff(m.getDb(), user.email!, true, { via: 'make-staff' });

    expect(result).toEqual({ userId: user.id, email: user.email, isStaff: true, changed: true });
    expect(await isStaff(user.id)).toBe(true);
    const [entry, ...rest] = await staffEntries(user.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      tenantId: null,
      userId: null,
      entity: 'user',
      entityId: user.id,
      action: 'grant_staff',
      before: { is_staff: false },
    });
    // Exactly these fields: the address stays out of the log, so deleting the
    // account later leaves no copy of it behind.
    expect(entry!.after).toEqual({ is_staff: true, via: 'make-staff' });
  });

  it('takes staff access away again, and both changes are in the audit log in order', async () => {
    const m = await import('./index.js');
    const db = m.getDb();
    const user = await signedInUser('provider');

    await m.setStaff(db, user.email!, true);
    expect(await isStaff(user.id)).toBe(true);
    const revoked = await m.setStaff(db, user.email!, false);

    expect(revoked).toMatchObject({ isStaff: false, changed: true });
    expect(await isStaff(user.id)).toBe(false);
    const entries = await staffEntries(user.id);
    expect(entries.map((e) => [e.action, e.before, (e.after as { is_staff: boolean }).is_staff])).toEqual([
      ['grant_staff', { is_staff: false }, true],
      ['revoke_staff', { is_staff: true }, false],
    ]);
    expect(entries.every((e) => e.tenantId === null)).toBe(true);
  });

  it('refuses an address no one has signed in with, and changes no row', async () => {
    const m = await import('./index.js');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    const unknown = `${uniq()}@example.org`;
    const countEntries = async () =>
      (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(m.auditLog)
          .where(eq(m.auditLog.entity, m.STAFF_AUDIT_ENTITY))
      )[0]!.n;
    const before = await countEntries();

    await expect(m.setStaff(db, unknown, true)).rejects.toThrow(m.StaffChangeRefused);
    await expect(m.setStaff(db, unknown, true)).rejects.toThrow(`No one has signed in as ${unknown} yet`);
    await expect(m.setStaff(db, unknown, false)).rejects.toThrow(`There is no account for ${unknown}`);
    await expect(m.setStaff(db, '   ', true)).rejects.toThrow(m.StaffChangeRefused);

    expect(await db.select().from(m.users).where(sql`lower(${m.users.email}) = lower(${unknown})`)).toEqual([]);
    expect(await countEntries()).toBe(before);
  });

  it('refuses an account made ahead of time for someone who has not signed in yet', async () => {
    const m = await import('./index.js');
    const db = m.getDb();
    // What create-tenant.ts leaves for an invited owner: an address and nothing else.
    const [invited] = await db.insert(m.users).values({ email: `${uniq()}@example.org` }).returning();
    userIds.push(invited!.id);

    await expect(m.setStaff(db, invited!.email!, true)).rejects.toThrow(`No one has signed in as ${invited!.email} yet`);

    expect(await isStaff(invited!.id)).toBe(false);
    expect(await staffEntries(invited!.id)).toEqual([]);
  });

  it('matches the address whatever its capitals, and writes nothing when access is already as asked', async () => {
    const m = await import('./index.js');
    const db = m.getDb();
    const user = await signedInUser('link');

    expect(await m.setStaff(db, `  ${user.email!.toUpperCase()} `, true)).toMatchObject({ userId: user.id, changed: true });
    expect(await m.setStaff(db, user.email!, true)).toMatchObject({ isStaff: true, changed: false });
    expect(await staffEntries(user.id)).toHaveLength(1);
  });

  it('lists everyone with staff access, with when it was granted', async () => {
    const m = await import('./index.js');
    const db = m.getDb();
    const staff = await signedInUser('link');
    const other = await signedInUser('link');
    await m.setStaff(db, staff.email!, true);

    const listed = await m.listStaff(db);
    const mine = listed.find((p) => p.userId === staff.id);
    expect(mine).toMatchObject({ email: staff.email });
    expect(mine!.grantedAt).toBeInstanceOf(Date);
    expect(Date.now() - mine!.grantedAt!.getTime()).toBeLessThan(60_000);
    expect(listed.some((p) => p.userId === other.id)).toBe(false);
  });

  it('keeps account entries away from the app role: none can be read or written there', async () => {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const user = await signedInUser('link');
    await m.setStaff(db, user.email!, true);

    // Not even the person the entry is about reads it through the app.
    const seen = await m.withAuthContext(db, user.id, (tx) =>
      tx.select().from(m.auditLog).where(eq(m.auditLog.entityId, user.id)),
    );
    expect(seen).toEqual([]);
    await expect(
      withPostgresError(
        m.withAuthContext(db, user.id, (tx) =>
          tx.insert(m.auditLog).values({
            tenantId: null, userId: user.id, entity: 'user', entityId: user.id, action: 'grant_staff',
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await staffEntries(user.id)).toHaveLength(1);
  });
});
