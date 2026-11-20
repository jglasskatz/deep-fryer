import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import * as m from '@deep-fryer/db';

/**
 * The run list's session lookup reads each run's session rows for one
 * portrait only: another portrait's runs never appear, whether the filter
 * or row-level security is what stops them, and a person outside the
 * portrait sees no sessions at all.
 */
let signedIn: string | null = null;
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)) }));
const unique = () => `runs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

describe.skipIf(!process.env.DATABASE_URL)('tenantRunSessionIds (Postgres/RLS)', () => {
  const tenants: m.Tenant[] = [];
  const users: string[] = [];
  let editor = '', outsider = '';
  const runsOf: Record<string, string[]> = {};
  const sessionsOf: Record<string, string[]> = {};
  const savedAuth = process.env.AUTH_SECRET;

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const db = m.getDb();
    for (const label of ['editor', 'outsider']) {
      const [user] = await db.insert(m.users).values({ email: `${unique()}@${label}.example.org` }).returning();
      users.push(user!.id);
    }
    [editor, outsider] = users as [string, string];
    for (const name of ['Run City', 'Other City']) {
      const seeded = await m.provisionTenant(db, { slug: unique(), name });
      tenants.push(seeded.tenant);
      const dimensionId = seeded.dimensions[0]!.dimensionId;
      // Two runs here, the first with two sessions and the second with one.
      for (const count of [2, 1]) {
        const [run] = await db.insert(m.researchRuns).values({
          tenantId: seeded.tenant.id, status: 'complete', appliedAt: new Date(),
          plan: { sessions: [], config_hash: 'test', plugin_version: 'test' },
          configSnapshot: defaultPortraitConfig(name, 'Municipal limits'),
        }).returning();
        const rows = await db.insert(m.researchSessions)
          .values(Array.from({ length: count }, () => ({ runId: run!.id, kind: 'dimension' as const, dimensionId, status: 'complete' as const })))
          .returning();
        (runsOf[seeded.tenant.id] ??= []).push(run!.id);
        sessionsOf[run!.id] = rows.map((r) => r.id);
      }
    }
    // The editor belongs to both portraits, so only the tenant filter keeps them apart.
    await db.insert(m.tenantMembers).values(tenants.map((t) => ({ tenantId: t.id, userId: editor, role: 'editor' as const })));
  });

  afterAll(async () => {
    signedIn = null;
    if (savedAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedAuth;
    const db = m.getDb();
    const runIds = Object.values(runsOf).flat();
    if (runIds.length) {
      await db.delete(m.researchSessions).where(inArray(m.researchSessions.runId, runIds));
      await db.delete(m.researchRuns).where(inArray(m.researchRuns.id, runIds));
    }
    for (const tenant of tenants) {
      await db.delete(m.tenantMembers).where(eq(m.tenantMembers.tenantId, tenant.id));
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    }
    if (users.length) await db.delete(m.users).where(inArray(m.users.id, users));
  });

  it('returns each run of the asked-for portrait with its own sessions, and nothing of another portrait', async () => {
    const { tenantRunSessionIds } = await import('./admin-data');
    signedIn = editor;
    const [first, second] = tenants as [m.Tenant, m.Tenant];
    const byRun = await tenantRunSessionIds(first.id);
    expect([...byRun.keys()].sort()).toEqual([...runsOf[first.id]!].sort());
    for (const runId of runsOf[first.id]!) expect([...byRun.get(runId)!].sort()).toEqual([...sessionsOf[runId]!].sort());
    for (const runId of runsOf[second.id]!) expect(byRun.has(runId)).toBe(false);
  });

  it('shows a person outside the portrait no sessions', async () => {
    const { tenantRunSessionIds } = await import('./admin-data');
    signedIn = outsider;
    expect((await tenantRunSessionIds(tenants[0]!.id)).size).toBe(0);
  });
});
