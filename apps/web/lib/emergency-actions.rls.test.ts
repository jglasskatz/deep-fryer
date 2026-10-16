import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';
import { setPortraitFeatures } from './test-features';

/**
 * The same actions for signed-in people (not dev mode): userDb runs as the
 * enforced `deep_fryer_app` role, so these prove the app-layer role gate and
 * the database policies agree — an editor's hazard write and its audit
 * entry pass row-level security, a viewer is refused before any SQL, and
 * the emergency config stays owner-only (tenant_config's write policy).
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user. The session is read
// through the pooled client, as in production (test/database-session.ts).
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `er-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('emergency actions under row-level security', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';
  const people: Record<'owner' | 'editor' | 'viewer', string> = { owner: '', editor: '', viewer: '' };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Policy City' });
    await setPortraitFeatures(tenant.id, { emergency: true });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  const hazard = { slug: 'coastal-storm', name: 'Coastal storms', kind: 'coastal_storm' as const, likelihood: 3, severity: 5 };

  it('lets an editor curate, through the database policies', async () => {
    const a = await import('./emergency-actions');
    signedIn = people.editor;
    const res = await a.createHazard({ tenantSlug, hazard });
    expect(res).toMatchObject({ ok: true });
    const id = (res as { ok: true; data: { id: string } }).data.id;
    expect(await a.setEmergencyPublished({ tenantSlug, entity: 'hazard', id, published: true })).toMatchObject({ ok: true });

    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.hazards).where(eq(m.hazards.id, id));
    expect(row).toMatchObject({ tenantId, slug: 'coastal-storm', published: true });
    const log = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, id));
    expect(log.map((l) => [l.action, l.userId])).toEqual([
      ['create', people.editor],
      ['publish', people.editor],
    ]);
  });

  it('refuses viewers, and keeps the alert configuration owner-only', async () => {
    const a = await import('./emergency-actions');
    signedIn = people.viewer;
    expect(await a.createHazard({ tenantSlug, hazard: { ...hazard, slug: 'other' } })).toEqual({
      ok: false,
      error: 'This needs the editor role on this portrait.',
    });
    signedIn = people.editor;
    expect(await a.saveEmergencyConfig({ tenantSlug, config: { nws_zones: ['NYC061'] } })).toEqual({
      ok: false,
      error: 'This needs the owner role on this portrait.',
    });
    signedIn = people.owner;
    expect(await a.saveEmergencyConfig({ tenantSlug, config: { nws_zones: ['NYC061'], info_phone: '311' } })).toMatchObject({
      ok: true,
      data: { nws_zones: ['NYC061'], info_phone: '311', time_zone: 'America/New_York' },
    });
    signedIn = null;
    expect(await a.deleteHazard({ tenantSlug, id: '00000000-0000-4000-8000-000000000000' })).toEqual({
      ok: false,
      error: 'This needs the editor role on this portrait.',
    });
  });

  it('refuses staff while Emergencies is off for the portrait (SPEC-v7 §3), and works again once it is on', async () => {
    const a = await import('./emergency-actions');
    const off = { ok: false, error: 'This feature is turned off for this portrait. An owner can turn it on in Settings.' };
    await setPortraitFeatures(tenantId, { emergency: false });
    try {
      signedIn = people.editor;
      expect(await a.createHazard({ tenantSlug, hazard: { ...hazard, slug: 'flag-off', name: 'Flag off' } })).toEqual(off);
      signedIn = people.owner;
      expect(await a.saveEmergencyConfig({ tenantSlug, config: { nws_zones: ['NYC061'] } })).toEqual(off);
      // The role is checked before the feature: a viewer learns nothing about which features a portrait has.
      signedIn = people.viewer;
      expect(await a.createHazard({ tenantSlug, hazard })).toEqual({
        ok: false,
        error: 'This needs the editor role on this portrait.',
      });
    } finally {
      await setPortraitFeatures(tenantId, { emergency: true });
    }
    signedIn = people.editor;
    const res = await a.createHazard({ tenantSlug, hazard: { ...hazard, slug: 'flag-on', name: 'Flag on' } });
    expect(res).toMatchObject({ ok: true });
    const id = (res as { ok: true; data: { id: string } }).data.id;
    expect(await a.deleteHazard({ tenantSlug, id })).toMatchObject({ ok: true });
    signedIn = null;
  });

  it('serves the public page to an anonymous visitor through the public-read policies', async () => {
    const a = await import('./emergency-actions');
    const { emergencyView } = await import('./emergency');
    signedIn = people.editor;
    expect(await a.createHazard({ tenantSlug, hazard: { ...hazard, slug: 'draft-only', name: 'Draft' } })).toMatchObject({ ok: true });
    signedIn = null;
    const view = await emergencyView(tenantSlug);
    expect(view!.config).toMatchObject({ nws_zones: ['NYC061'], info_phone: '311' });
    // Published by the editor above; the draft stays staff-only.
    expect(view!.hazards.map((h) => h.slug)).toEqual(['coastal-storm']);
    expect(view!.sync.stale).toBe(true);
  });

  it('runs every write on its own transaction, audit entries included', async () => {
    // Each action audits inside its userDb transaction, and audit() reads its
    // actor with getAuth(). In a server action that was a fresh session read
    // on the pooled client (React's cache() does not memoize there), waiting
    // for a second connection while the transaction held the first; on a
    // one-connection pool, one request waited forever (test/one-connection.ts).
    // saveEmergencyConfig also read the author with getAuth() itself.
    type Actions = typeof import('./emergency-actions');
    const run = <T>(fn: (a: Actions) => Promise<T>) => onOneConnection(async () => fn(await import('./emergency-actions')));
    const idOf = (res: unknown) => {
      expect(res).toMatchObject({ ok: true });
      return (res as { ok: true; data: { id: string } }).data.id;
    };
    const ok = { ok: true, data: undefined };

    signedIn = people.owner;
    expect(await run((a) => a.saveEmergencyConfig({ tenantSlug, config: { nws_zones: ['NYC061'], info_phone: '311' } }))).toMatchObject({
      ok: true,
    });

    signedIn = people.editor;
    const flood = { slug: 'one-connection-flood', name: 'Flooding', kind: 'flooding' as const, likelihood: 4, severity: 4 };
    const hazardId = idOf(await run((a) => a.createHazard({ tenantSlug, hazard: flood })));
    expect(await run((a) => a.updateHazard({ tenantSlug, id: hazardId, hazard: { ...flood, slug: 'one-connection-floods' } }))).toEqual(ok);
    expect(await run((a) => a.setEmergencyPublished({ tenantSlug, entity: 'hazard', id: hazardId, published: true }))).toEqual(ok);

    const plan = { title: 'Flood plan', agency: 'Emergency Management', url: 'https://example.gov/flood', hazard_slugs: ['one-connection-floods'] };
    const planId = idOf(await run((a) => a.createPlan({ tenantSlug, plan })));
    expect(await run((a) => a.updatePlan({ tenantSlug, id: planId, plan: { ...plan, title: 'Flood mitigation plan' } }))).toEqual(ok);

    const resource = { name: 'Flood hotline', kind: 'hotline' as const, phone: '311', hazard_slugs: ['one-connection-floods'] };
    const resourceId = idOf(await run((a) => a.createResource({ tenantSlug, resource })));
    expect(await run((a) => a.updateResource({ tenantSlug, id: resourceId, resource: { ...resource, name: 'Flood help line' } }))).toEqual(ok);

    expect(await run((a) => a.deleteResource({ tenantSlug, id: resourceId }))).toEqual(ok);
    expect(await run((a) => a.deletePlan({ tenantSlug, id: planId }))).toEqual(ok);
    expect(await run((a) => a.deleteHazard({ tenantSlug, id: hazardId }))).toEqual(ok);

    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const log = await m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(inArray(m.auditLog.entityId, [hazardId, planId, resourceId]))
      .orderBy(m.auditLog.id);
    expect(log.map((l) => [l.entity, l.action, l.userId])).toEqual([
      ['hazard', 'create', people.editor],
      ['hazard', 'update', people.editor],
      ['hazard', 'publish', people.editor],
      ['emergency_plan', 'create', people.editor],
      ['emergency_plan', 'update', people.editor],
      ['emergency_resource', 'create', people.editor],
      ['emergency_resource', 'update', people.editor],
      ['emergency_resource', 'delete', people.editor],
      ['emergency_plan', 'delete', people.editor],
      ['hazard', 'delete', people.editor],
    ]);
    signedIn = null;
  });
});
