import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Who sees a portrait through the public read paths (migration 0015): one
 * that has not published yet renders for its members and is a 404 for
 * everyone else; the reads that must not depend on who is asking — the
 * open-data API, the landing page's lists — never serve it, not even to its
 * members; once it publishes, everyone gets it. Against the dev database,
 * as each person reaches it in production (AUTH_SECRET set, so userDb runs
 * under row-level security).
 */

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    signedIn ? { user: { id: signedIn, email: `${signedIn}@example.gov`, displayName: null, isStaff: false } } : null,
  ),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('public read paths for a portrait that has not published yet', () => {
  const saved = process.env.AUTH_SECRET;
  const ids = { tenants: [] as string[], organizations: [] as string[], users: [] as string[] };
  let member = '';
  let stranger = '';
  let orgSlug = '';
  let hidden = { id: '', slug: '' };
  let shown = { id: '', slug: '' };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'public-data-test-secret';
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const people = await db
      .insert(m.users)
      .values([{ email: `${uniq()}@example.gov` }, { email: `${uniq()}@example.org` }])
      .returning();
    [member, stranger] = people.map((p) => p.id) as [string, string];
    ids.users.push(member, stranger);
    // One organization, two portraits: one published (family order 2), one not yet (family order 1).
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Pd Family' });
    orgSlug = org.slug;
    ids.organizations.push(org.id);
    const a = await m.provisionTenant(db, { slug: uniq(), name: 'Draft Ward', organizationId: org.id, familyOrder: 1 });
    const b = await m.provisionTenant(db, { slug: uniq(), name: 'Live Ward', organizationId: org.id, familyOrder: 2 });
    ids.tenants.push(a.tenant.id, b.tenant.id);
    hidden = { id: a.tenant.id, slug: a.tenant.slug };
    shown = { id: b.tenant.id, slug: b.tenant.slug };
    await db.insert(m.tenantMembers).values({ tenantId: hidden.id, userId: member, role: 'viewer' });
    // Publish one of Live Ward's dimensions, as lib/publish.ts does; the database marks the portrait public.
    const dimId = b.dimensions[0]!.dimensionId;
    const v = (await m.latestVersion(db, dimId))!;
    await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, v.id));
    await db.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dimId));
  });

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    await db.update(m.dimensions).set({ publishedVersionId: null }).where(inArray(m.dimensions.tenantId, ids.tenants));
    await db.delete(m.tenants).where(inArray(m.tenants.id, ids.tenants));
    await db.delete(m.organizations).where(inArray(m.organizations.id, ids.organizations));
    await db.delete(m.users).where(inArray(m.users.id, ids.users));
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    signedIn = null;
  });

  it('renders the portrait for its members and is a 404 for anyone else', async () => {
    const { getPortrait } = await import('./data');
    signedIn = null;
    expect(await getPortrait(hidden.slug)).toBeNull();
    signedIn = stranger;
    expect(await getPortrait(hidden.slug)).toBeNull();
    signedIn = member;
    expect(await getPortrait(hidden.slug)).toMatchObject({ tenant: { slug: hidden.slug, name: 'Draft Ward' }, dimensions: [] });
    // A published portrait is everyone's.
    signedIn = null;
    expect((await getPortrait(shown.slug))?.dimensions).toHaveLength(1);
  });

  it('never serves it through the reads every reader shares, not even to its members', async () => {
    const { getPublicPortrait, publicPortraits, publicTenant } = await import('./data');
    signedIn = member;
    expect(await getPublicPortrait(hidden.slug)).toBeNull();
    expect(await publicTenant(hidden.slug)).toBeNull();
    expect((await getPublicPortrait(shown.slug))?.dimensions).toHaveLength(1);
    expect((await publicTenant(shown.slug))?.id).toBe(shown.id);
    expect(await publicTenant('Not A Slug')).toBeNull();

    // The organization's list is its public portraits, in family order; the deployment's includes them too.
    expect(await publicPortraits(orgSlug)).toEqual([
      { slug: shown.slug, name: 'Live Ward', region: null, organization: { slug: orgSlug, name: 'Pd Family' } },
    ]);
    const everything = (await publicPortraits()).map((p) => p.slug);
    expect(everything).toContain(shown.slug);
    expect(everything).not.toContain(hidden.slug);
    expect(await publicPortraits('Not A Slug')).toEqual([]);
  });

  it('keeps the open-data API to public portraits, whoever calls', async () => {
    const portrait = await import('@/app/api/v1/portraits/[tenant]/route');
    const progressJson = await import('@/app/api/v1/portraits/[tenant]/progress.json/route');
    const progressCsv = await import('@/app/api/v1/portraits/[tenant]/progress.csv/route');
    const call = (route: { GET: (req: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response> }, slug: string) =>
      route.GET(new Request(`http://localhost/api/v1/portraits/${slug}`), { params: Promise.resolve({ tenant: slug }) });
    for (const who of [member, null]) {
      signedIn = who;
      expect((await call(portrait, hidden.slug)).status).toBe(404);
      expect((await call(progressJson, hidden.slug)).status).toBe(404);
      expect((await call(progressCsv, hidden.slug)).status).toBe(404);
      expect((await call(portrait, shown.slug)).status).toBe(200);
      expect((await call(progressJson, shown.slug)).status).toBe(200);
      expect((await call(progressCsv, shown.slug)).status).toBe(200);
    }
  });
});
