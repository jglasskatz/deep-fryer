import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The sample-data mark (core SAMPLE_DATA_CONFIG_KEY, written by
 * scripts/seed-demo-data.ts) as the public plane reads it: a page asks as
 * the person, so it sees the mark on every portrait it can see — a public
 * one for anyone, a private one for its members — and the open-data API
 * asks as an anonymous visitor, so it never answers for a private portrait.
 * Against the dev database under row-level security (AUTH_SECRET set).
 */

let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    signedIn ? { user: { id: signedIn, email: `${signedIn}@example.gov`, displayName: null, isStaff: false } } : null,
  ),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('which portraits carry sample data', () => {
  const saved = process.env.AUTH_SECRET;
  const ids = { tenants: [] as string[], organizations: [] as string[], users: [] as string[] };
  let member = '';
  let marked = '';
  let plain = '';
  let privateMarked = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'sample-data-test-secret';
    const m = await import('@deep-fryer/db');
    const { markPortraitPublic } = await import('./test-portraits');
    const db = m.getDb();
    const [person] = await db.insert(m.users).values({ email: `${uniq()}@example.gov` }).returning();
    member = person!.id;
    ids.users.push(member);
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Sd Family' });
    ids.organizations.push(org.id);
    const [a, b, c] = await Promise.all(
      ['Seeded Ward', 'Researched Ward', 'Draft Ward'].map((name) =>
        m.provisionTenant(db, { slug: uniq(), name, organizationId: org.id }),
      ),
    );
    ids.tenants.push(a!.tenant.id, b!.tenant.id, c!.tenant.id);
    [marked, plain, privateMarked] = [a!.tenant.slug, b!.tenant.slug, c!.tenant.slug];
    await markPortraitPublic(a!.tenant.id);
    await markPortraitPublic(b!.tenant.id);
    // What the seeding script writes; the researched portrait has a stray false, which is no mark.
    await db.insert(m.tenantConfig).values([
      { tenantId: a!.tenant.id, key: 'sample_data', value: true },
      { tenantId: b!.tenant.id, key: 'sample_data', value: false },
      { tenantId: c!.tenant.id, key: 'sample_data', value: true },
    ]);
    await db.insert(m.tenantMembers).values({ tenantId: c!.tenant.id, userId: member, role: 'viewer' });
  });

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    await db.delete(m.tenants).where(inArray(m.tenants.id, ids.tenants));
    await db.delete(m.organizations).where(inArray(m.organizations.id, ids.organizations));
    await db.delete(m.users).where(inArray(m.users.id, ids.users));
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    signedIn = null;
  });

  it('labels a seeded public portrait for every reader, and only that one', async () => {
    const { portraitSampleData } = await import('./sample-data');
    for (const who of [null, member]) {
      signedIn = who;
      expect(await portraitSampleData(marked)).toBe(true);
      expect(await portraitSampleData(plain)).toBe(false);
    }
  });

  it('labels a private seeded portrait for its members, who are the only ones who can open it', async () => {
    const { portraitSampleData } = await import('./sample-data');
    signedIn = null;
    expect(await portraitSampleData(privateMarked)).toBe(false);
    signedIn = member;
    expect(await portraitSampleData(privateMarked)).toBe(true);
  });

  it('labels an organization page when any portrait it shows is seeded', async () => {
    const { anySampleData } = await import('./sample-data');
    signedIn = null;
    expect(await anySampleData([plain, marked])).toBe(true);
    expect(await anySampleData([plain])).toBe(false);
    // The private one is not on an anonymous visitor's page, so it does not label it.
    expect(await anySampleData([plain, privateMarked])).toBe(false);
    expect(await anySampleData([])).toBe(false);
  });

  it('answers the open-data API as the public sees it, whoever is asking', async () => {
    const { publicPortraitSampleData } = await import('./sample-data');
    signedIn = member;
    expect(await publicPortraitSampleData(marked)).toBe(true);
    expect(await publicPortraitSampleData(plain)).toBe(false);
    expect(await publicPortraitSampleData(privateMarked)).toBe(false);
    // A path segment that cannot be a slug never reaches a query.
    expect(await publicPortraitSampleData('../etc')).toBe(false);
  });
});
