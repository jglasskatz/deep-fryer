import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { markPortraitPublic } from './test-portraits';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)) }));
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `manage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('portrait structure and outreach version management', () => {
  const originalSecret = process.env.AUTH_SECRET;
  const people = { owner: '', editor: '', viewer: '' };
  const cleanup = { tenants: [] as string[], organizations: [] as string[], users: [] as string[] };
  let tenantId = ''; let tenantSlug = ''; let otherSlug = ''; let dimensionId = ''; let dimensionVersion = ''; let contactId = ''; let contactVersion = '';
  beforeAll(async () => {
    process.env.AUTH_SECRET = 'management-test';
    const m = await import('@deep-fryer/db');
    for (const index of [0, 1]) {
      const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name: 'Management test' });
      cleanup.tenants.push(tenant.id); cleanup.organizations.push(tenant.organizationId);
      await markPortraitPublic(tenant.id);
      if (!index) { tenantId = tenant.id; tenantSlug = tenant.slug; } else otherSlug = tenant.slug;
    }
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const [person] = await m.getDb().insert(m.users).values({ email: `${uniq()}@example.gov` }).returning();
      people[role] = person!.id; cleanup.users.push(person!.id);
      for (const id of cleanup.tenants) await m.getDb().insert(m.tenantMembers).values({ tenantId: id, userId: person!.id, role });
    }
  });
  afterAll(async () => {
    const m = await import('@deep-fryer/db'); const { inArray } = await import('drizzle-orm');
    if (cleanup.tenants.length) await m.getDb().delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenants));
    if (cleanup.organizations.length) await m.getDb().delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizations));
    if (cleanup.users.length) await m.getDb().delete(m.users).where(inArray(m.users.id, cleanup.users));
    if (originalSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = originalSecret;
  });

  it('creates owner-authored draft dimensions with distinct addresses and canonical indicator defaults', async () => {
    const a = await import('./dimension-admin-actions');
    signedIn = people.owner;
    const created = await a.createDimension({ tenantSlug, slug: 'flood-exposure', name: 'Flood exposure', ring: 'ecological', indicatorNames: ['Floodplain residents'] });
    if (!created.ok) throw new Error(created.error);
    dimensionId = created.data.dimensionId; dimensionVersion = created.data.versionId;
    const m = await import('@deep-fryer/db');
    expect(await m.latestVersion(m.getDb(), dimensionId)).toMatchObject({ status: 'draft', origin: 'human', createdBy: people.owner, data: { name: 'Flood exposure', indicators: [{ name: 'Floodplain residents', value: null }] } });
    expect(await a.createDimension({ tenantSlug, slug: 'flood-exposure', name: 'Duplicate', ring: 'social' })).toMatchObject({ ok: false, error: expect.stringContaining('already exists') });
    expect(await a.createDimension({ tenantSlug, slug: 'bad-canonical', name: 'Invalid', ring: 'social', canonicalSlug: 'air-pollution' })).toMatchObject({ ok: false });
    expect(await a.createDimension({ tenantSlug, slug: 'mixed-indicators', name: 'Invalid mixed definition', ring: 'social', canonicalSlug: 'health', indicatorNames: ['A different measure'] })).toMatchObject({ ok: false });
    const canonical = await a.createDimension({ tenantSlug, slug: 'local-health', name: 'Local health', ring: 'social', canonicalSlug: 'health', indicatorNames: [] });
    if (!canonical.ok) throw new Error(canonical.error);
    expect((await m.latestVersion(m.getDb(), canonical.data.dimensionId))!.data.indicators.length).toBeGreaterThan(0);
  });

  it('preserves published versions across archival/restoration and reorders every active dimension atomically', async () => {
    const a = await import('./dimension-admin-actions');
    const { publishVersion } = await import('./actions');
    const { getPublicPortrait } = await import('./data');
    const { portraitDimensionsForAdmin } = await import('./portrait-management');
    signedIn = people.owner;
    expect(await publishVersion({ tenantSlug, versionId: dimensionVersion })).toMatchObject({ ok: true });
    expect((await getPublicPortrait(tenantSlug))!.dimensions.map(d => d.slug)).toContain('flood-exposure');
    expect(await a.setDimensionArchived({ tenantSlug, dimensionId, archived: true, reason: 'Testing a reversible framework change.' })).toMatchObject({ ok: true });
    expect((await getPublicPortrait(tenantSlug))!.dimensions.map(d => d.slug)).not.toContain('flood-exposure');
    const active = (await portraitDimensionsForAdmin(tenantId)).filter(d => !d.archivedAt).map(d => d.id).reverse();
    expect(await a.reorderDimensions({ tenantSlug, dimensionIds: active })).toMatchObject({ ok: true });
    expect((await portraitDimensionsForAdmin(tenantId)).filter(d => !d.archivedAt).map(d => d.id)).toEqual(active);
    expect(await a.reorderDimensions({ tenantSlug, dimensionIds: active.slice(1) })).toMatchObject({ ok: false });
    expect(await a.reorderDimensions({ tenantSlug, dimensionIds: [...active.slice(1), active[1]!] })).toMatchObject({ ok: false });
    expect(await a.setDimensionArchived({ tenantSlug, dimensionId, archived: false, reason: 'Restore the same recorded dimension.' })).toMatchObject({ ok: true });
    expect((await getPublicPortrait(tenantSlug))!.dimensions.map(d => d.slug)).toContain('flood-exposure');
  });

  it('enforces structural owner access independently in actions and Postgres', async () => {
    const a = await import('./dimension-admin-actions'); const m = await import('@deep-fryer/db'); const { eq } = await import('drizzle-orm');
    signedIn = people.editor;
    expect(await a.createDimension({ tenantSlug, slug: 'forged', name: 'Forged', ring: 'social' })).toMatchObject({ ok: false, error: 'This needs the owner role on this portrait.' });
    await expect(m.withAuthContext(m.getDb(), people.editor, db => db.update(m.dimensions).set({ displayOrder: 99 }).where(eq(m.dimensions.id, dimensionId)))).rejects.toThrow('requires an owner');
    await expect(m.withAuthContext(m.getDb(), people.owner, db => db.update(m.dimensions).set({ slug: 'changed-address' }).where(eq(m.dimensions.id, dimensionId)))).rejects.toThrow('immutable');
    signedIn = people.owner;
    expect(await a.setDimensionArchived({ tenantSlug: otherSlug, dimensionId, archived: true, reason: 'Wrong tenant' })).toMatchObject({ ok: false, error: 'Unknown dimension.' });
  });

  const contact = { org: 'Local civic group', website: 'https://example.gov/participate', why: 'Attend public meetings.', tags: ['civic'], data_needs: ['Staff research need'], person: 'Staff contact', email: 'private@example.gov', phone: '555-0100', address: 'Staff address', draft_message: 'Private outreach draft.' };
  it('publishes only reviewed public contact fields while preserving immutable staff drafts', async () => {
    const a = await import('./outreach-admin-actions'); const { publishedOutreachContacts } = await import('./data');
    signedIn = people.editor;
    const saved = await a.saveOutreachContact({ tenantSlug, data: contact });
    if (!saved.ok) throw new Error(saved.error);
    contactId = saved.data.contactId; contactVersion = saved.data.versionId;
    expect(await publishedOutreachContacts(tenantSlug)).toEqual([]);
    expect(await a.publishOutreachContact({ tenantSlug, contactId, versionId: contactVersion })).toMatchObject({ ok: true });
    expect(await publishedOutreachContacts(tenantSlug)).toEqual([{ org: contact.org, website: contact.website, why: contact.why, tags: contact.tags }]);
    const copies = await Promise.all([1, 2].map(index => a.saveOutreachContact({ tenantSlug, contactId, data: { ...contact, org: `Draft organization ${index}` } })));
    expect(copies.every(result => result.ok)).toBe(true);
    const { outreachContactsForAdmin } = await import('./portrait-management');
    expect((await outreachContactsForAdmin(tenantId))[0]!.versions.map(version => version.versionNum)).toEqual([3, 2, 1]);
    expect((await publishedOutreachContacts(tenantSlug))[0]!.org).toBe(contact.org);
    expect(await a.setOutreachArchived({ tenantSlug, contactId, archived: true })).toMatchObject({ ok: true });
    expect(await publishedOutreachContacts(tenantSlug)).toEqual([]);
    expect(await a.setOutreachArchived({ tenantSlug, contactId, archived: false })).toMatchObject({ ok: true });
    expect((await publishedOutreachContacts(tenantSlug))[0]!.org).toBe(contact.org);
  });

  it('rejects viewer/cross-tenant writes, unsafe contact URLs, and direct content mutation', async () => {
    const a = await import('./outreach-admin-actions'); const m = await import('@deep-fryer/db'); const { eq } = await import('drizzle-orm');
    signedIn = people.viewer;
    expect(await a.saveOutreachContact({ tenantSlug, data: contact })).toMatchObject({ ok: false });
    signedIn = people.editor;
    expect(await a.saveOutreachContact({ tenantSlug: otherSlug, contactId, data: contact })).toMatchObject({ ok: false, error: 'Unknown contact.' });
    expect(await a.saveOutreachContact({ tenantSlug, data: { ...contact, website: 'javascript:alert(1)' } })).toMatchObject({ ok: false });
    await expect(m.withAuthContext(m.getDb(), people.editor, db => db.update(m.outreachContactVersions).set({ data: { ...contact, org: 'Overwrite' } }).where(eq(m.outreachContactVersions.id, contactVersion)))).rejects.toThrow('immutable');
  });
});
