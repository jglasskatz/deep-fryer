import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { markPortraitPublic } from './test-portraits';
import { setPortraitFeatures } from './test-features';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)) }));
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `pages-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('custom pages through editor actions and anonymous RLS', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const people = { owner: '', editor: '', viewer: '' };
  const cleanup = { tenantIds: [] as string[], organizationIds: [] as string[], userIds: [] as string[] };
  let tenantId = '';
  let tenantSlug = '';
  let privateId = '';
  let privateSlug = '';
  let pageId = '';
  let originalVersion = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'custom-page-test';
    const m = await import('@deep-fryer/db');
    for (const isPublic of [true, false]) {
      const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name: 'Civic pages test' });
      cleanup.tenantIds.push(tenant.id); cleanup.organizationIds.push(tenant.organizationId);
      await setPortraitFeatures(tenant.id, { custom_pages: true });
      if (isPublic) { tenantId = tenant.id; tenantSlug = tenant.slug; await markPortraitPublic(tenant.id); }
      else { privateId = tenant.id; privateSlug = tenant.slug; }
    }
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const [person] = await m.getDb().insert(m.users).values({ email: `${uniq()}@example.gov` }).returning();
      people[role] = person!.id; cleanup.userIds.push(person!.id);
      for (const id of cleanup.tenantIds) await m.getDb().insert(m.tenantMembers).values({ tenantId: id, userId: person!.id, role });
    }
  });
  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    if (cleanup.tenantIds.length) await m.getDb().delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    if (cleanup.organizationIds.length) await m.getDb().delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    if (cleanup.userIds.length) await m.getDb().delete(m.users).where(inArray(m.users.id, cleanup.userIds));
    if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  });

  it('keeps drafts private, publishes explicitly, and preserves published content while editing', async () => {
    const a = await import('./custom-page-actions');
    const { publishedCustomPages } = await import('./custom-pages');
    signedIn = people.editor;
    const saved = await a.saveCustomPage({ tenantSlug, slug: 'adopted-plan', title: 'Adopted plan', body: '# Our goals\n\nA civic plan.' });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    ({ pageId, versionId: originalVersion } = saved.data);
    expect(await publishedCustomPages(tenantSlug)).toEqual([]);
    expect(await a.publishCustomPage({ tenantSlug, pageId, versionId: originalVersion })).toMatchObject({ ok: true });
    const publicPage = (await publishedCustomPages(tenantSlug))[0]!;
    expect(publicPage).toMatchObject({ slug: 'adopted-plan', title: 'Adopted plan', versionNum: 1 });
    const draft = await a.saveCustomPage({ tenantSlug, pageId, slug: 'adopted-plan', title: 'Changed title', body: 'Not yet approved.' });
    expect(draft.ok).toBe(true);
    expect((await publishedCustomPages(tenantSlug))[0]!.title).toBe('Adopted plan');
    const { listCustomPagesForAdmin } = await import('./custom-pages');
    expect((await listCustomPagesForAdmin(tenantId))[0]!.versions.map(v => v.versionNum)).toEqual([2, 1]);
  });

  it('allocates concurrent draft versions atomically and refuses renamed/cross-tenant edits', async () => {
    const a = await import('./custom-page-actions');
    signedIn = people.editor;
    const results = await Promise.all([1, 2].map(index => a.saveCustomPage({ tenantSlug, pageId, slug: 'adopted-plan', title: `Draft ${index}`, body: 'Draft' })));
    expect(results.every(result => result.ok)).toBe(true);
    const { listCustomPagesForAdmin } = await import('./custom-pages');
    expect((await listCustomPagesForAdmin(tenantId))[0]!.versions.map(v => v.versionNum)).toEqual([4, 3, 2, 1]);
    expect(await a.saveCustomPage({ tenantSlug, pageId, slug: 'another-address', title: 'Renamed', body: 'draft' })).toMatchObject({ ok: false });
    expect(await a.saveCustomPage({ tenantSlug: privateSlug, pageId, slug: 'adopted-plan', title: 'Wrong portrait', body: 'draft' })).toMatchObject({ ok: false, error: 'Unknown page.' });
  });

  it('refuses viewers and outsiders before writing', async () => {
    const a = await import('./custom-page-actions');
    for (const user of [people.viewer, null]) {
      signedIn = user;
      expect(await a.saveCustomPage({ tenantSlug, slug: 'forged', title: 'Forged', body: 'body' })).toMatchObject({ ok: false, error: 'This needs the editor role on this portrait.' });
      expect(await a.unpublishCustomPage({ tenantSlug, pageId })).toMatchObject({ ok: false });
    }
  });

  it('publishes no pages from a portrait that has never published a dimension', async () => {
    const a = await import('./custom-page-actions');
    const { publishedCustomPages } = await import('./custom-pages');
    signedIn = people.editor;
    const saved = await a.saveCustomPage({ tenantSlug: privateSlug, slug: 'private-plan', title: 'Private plan', body: 'Private body' });
    if (!saved.ok) throw new Error(saved.error);
    expect(await a.publishCustomPage({ tenantSlug: privateSlug, ...saved.data })).toMatchObject({ ok: true });
    expect(await publishedCustomPages(privateSlug)).toEqual([]);
    expect(privateId).not.toBe(tenantId);
  });

  it('enforces immutable content and same-page publication independently in Postgres', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    await expect(m.withAuthContext(m.getDb(), people.editor, db => db.update(m.customPageVersions).set({ mdxBody: 'overwrite' }).where(eq(m.customPageVersions.id, originalVersion)))).rejects.toThrow('immutable');
    const [other] = await m.getDb().select().from(m.customPages).where(eq(m.customPages.tenantId, privateId));
    await expect(m.withAuthContext(m.getDb(), people.editor, db => db.update(m.customPages).set({ publishedVersionId: originalVersion }).where(eq(m.customPages.id, other!.id)))).rejects.toThrow('must belong');
    await expect(m.withAuthContext(m.getDb(), people.editor, db => db.delete(m.customPages).where(eq(m.customPages.id, pageId)))).rejects.toThrow('permission denied');
  });

  it('hides public content and refuses actions when the feature is off, checking roles first', async () => {
    const a = await import('./custom-page-actions');
    const { publishedCustomPages } = await import('./custom-pages');
    const { requireFeature } = await import('./features');
    await setPortraitFeatures(tenantId, { custom_pages: false });
    try {
      expect(await publishedCustomPages(tenantSlug)).toEqual([]);
      await expect(requireFeature(tenantSlug, 'custom_pages')).rejects.toMatchObject({ digest: expect.stringContaining('404') });
      signedIn = people.editor;
      expect(await a.unpublishCustomPage({ tenantSlug, pageId })).toMatchObject({ ok: false, error: expect.stringContaining('turned off') });
      signedIn = people.viewer;
      expect(await a.unpublishCustomPage({ tenantSlug, pageId })).toMatchObject({ ok: false, error: 'This needs the editor role on this portrait.' });
    } finally { await setPortraitFeatures(tenantId, { custom_pages: true }); }
  });

  it('requires another editor under dual review, and supports reversible unpublish/revert', async () => {
    const m = await import('@deep-fryer/db');
    const a = await import('./custom-page-actions');
    const { publishedCustomPages } = await import('./custom-pages');
    await m.getDb().insert(m.tenantConfig).values({ tenantId, key: 'review_policy', value: { require_approval: 'all', dual_review_on_edits: true, first_post_requires_approval: false } }).onConflictDoUpdate({ target: [m.tenantConfig.tenantId, m.tenantConfig.key], set: { value: { require_approval: 'all', dual_review_on_edits: true, first_post_requires_approval: false } } });
    signedIn = people.editor;
    const draft = await a.saveCustomPage({ tenantSlug, pageId, slug: 'adopted-plan', title: 'A new reviewed page', body: 'A changed draft.' });
    if (!draft.ok) throw new Error(draft.error);
    expect(await a.publishCustomPage({ tenantSlug, pageId, versionId: draft.data.versionId })).toMatchObject({ ok: false, error: expect.stringContaining('Another signed-in editor') });
    signedIn = people.owner;
    expect(await a.publishCustomPage({ tenantSlug, pageId, versionId: draft.data.versionId })).toMatchObject({ ok: true });
    expect(await a.unpublishCustomPage({ tenantSlug, pageId })).toMatchObject({ ok: true });
    expect(await publishedCustomPages(tenantSlug)).toEqual([]);
    expect(await a.publishCustomPage({ tenantSlug, pageId, versionId: originalVersion })).toMatchObject({ ok: true });
    expect((await publishedCustomPages(tenantSlug))[0]!.versionNum).toBe(1);
  });
});
