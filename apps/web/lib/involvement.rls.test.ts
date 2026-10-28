import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { markPortraitPublic } from './test-portraits';
import { publishInvolvementTestDimensions } from './test-involvement-dimensions';

/**
 * Getting involved under row-level security (migration 0010), as each kind
 * of person reaches the database — the enforced `deep_fryer_app` role via
 * withAuthContext, independently of any app code:
 *
 * - anyone, signed in or not, may file a *new* submission for a live
 *   portrait, but cannot read it back, nor forge anything a reviewer sets;
 * - only the portrait's editors read, review, or delete submissions (they
 *   hold contact details) — not its viewers, not another portrait's editor;
 * - the public reads published listings only, and the app's public read
 *   path (lib/involvement.ts) shows published listings even to staff, who
 *   may read drafts;
 * - the rate-limit counts are available to anyone, as two numbers.
 */

// Whoever `signedIn` names is the request's user (for the app read path).
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    signedIn ? { user: { id: signedIn, email: `${signedIn}@example.gov`, displayName: null, isStaff: false } } : null,
  ),
}));

type DbExecutor = import('@deep-fryer/db').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const RLS = /row-level security/;

describe.skipIf(!hasDb)('involvement under row-level security', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantIds: string[]; organizationIds: string[]; userIds: string[] } = {
    tenantIds: [],
    organizationIds: [],
    userIds: [],
  };
  let cityA = { id: '', slug: '' };
  let cityB = { id: '', slug: '' };
  const people: Record<'editorA' | 'viewerA' | 'editorB' | 'resident', string> = {
    editorA: '',
    viewerA: '',
    editorB: '',
    resident: '',
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'involvement-rls-test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    for (const which of ['A', 'B'] as const) {
      const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: `City ${which}` });
      // Public, as its first publish would make it (migration 0015): anonymous visitors only reach public portraits.
      await markPortraitPublic(tenant.id);
      await publishInvolvementTestDimensions(tenant.id);
      cleanup.tenantIds.push(tenant.id);
      cleanup.organizationIds.push(tenant.organizationId);
      if (which === 'A') cityA = { id: tenant.id, slug: tenant.slug };
      else cityB = { id: tenant.id, slug: tenant.slug };
    }
    const members = [
      ['editorA', cityA.id, 'editor'],
      ['viewerA', cityA.id, 'viewer'],
      ['editorB', cityB.id, 'editor'],
      ['resident', null, null],
    ] as const;
    for (const [who, tenantId, role] of members) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${who.toLowerCase()}.example.org` }).returning();
      people[who] = user!.id;
      cleanup.userIds.push(user!.id);
      if (tenantId && role) await db.insert(m.tenantMembers).values({ tenantId, userId: user!.id, role });
    }
    // One published listing and one draft on city A (system context, as a seed script writes them).
    await db.insert(m.involvementListings).values([
      { tenantId: cityA.id, name: 'Food bank shifts', description: 'Sort and pack food.', kind: 'volunteer', dimensionSlugs: ['food'], published: true },
      { tenantId: cityA.id, name: 'Draft listing', description: 'Not checked yet.', kind: 'civic', published: false },
    ]);
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (cleanup.tenantIds.length) await db.delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    if (cleanup.organizationIds.length) {
      await db.delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    }
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function as<T>(userId: string | null, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const m = await import('@deep-fryer/db');
    return m.withAuthContext(m.getDb(), userId, fn);
  }

  const submission = (tenantId: string, extra: Record<string, unknown> = {}) => ({
    tenantId,
    kind: 'listing' as const,
    orgName: 'Tenants United',
    about: 'A tenants’ association.',
    pitch: 'Come to a building meeting.',
    contactName: 'Ana',
    email: `${uniq()}@example.org`,
    locale: 'en',
    ipHash: 'a'.repeat(32),
    ...extra,
  });

  async function submissionsOf(userId: string | null, tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return as(userId, (tx) =>
      tx.select().from(m.involvementSubmissions).where(eq(m.involvementSubmissions.tenantId, tenantId)),
    );
  }

  it('lets anyone file a new submission, but not read it back', async () => {
    const m = await import('@deep-fryer/db');
    await as(null, (tx) => tx.insert(m.involvementSubmissions).values(submission(cityA.id)));
    await as(people.resident, (tx) => tx.insert(m.involvementSubmissions).values(submission(cityA.id)));
    expect(await submissionsOf(null, cityA.id)).toHaveLength(0);
    expect(await submissionsOf(people.resident, cityA.id)).toHaveLength(0);
    // RETURNING needs SELECT on the new row, which the submitter does not have.
    await expect(
      as(null, (tx) => tx.insert(m.involvementSubmissions).values(submission(cityA.id)).returning()),
    ).rejects.toThrow(RLS);
  });

  it('refuses anything a reviewer sets, and a portrait that is archived', async () => {
    const m = await import('@deep-fryer/db');
    const insert = (extra: Record<string, unknown>, tenantId = cityA.id) =>
      as(null, (tx) => tx.insert(m.involvementSubmissions).values(submission(tenantId, extra)));
    await expect(insert({ status: 'approved' })).rejects.toThrow(RLS);
    await expect(insert({ status: 'spam' })).rejects.toThrow(RLS);
    await expect(insert({ reviewedBy: people.editorA })).rejects.toThrow(RLS);
    await expect(insert({ reviewedAt: new Date() })).rejects.toThrow(RLS);
    await expect(insert({ reviewNote: 'looks fine' })).rejects.toThrow(RLS);
    await expect(insert({ listingId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(RLS);

    const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name: 'Archived City' });
    cleanup.tenantIds.push(tenant.id);
    cleanup.organizationIds.push(tenant.organizationId);
    // Public once, then archived: the refusal below is the archive's, not the portrait being private.
    await markPortraitPublic(tenant.id);
      await publishInvolvementTestDimensions(tenant.id);
    const { eq } = await import('drizzle-orm');
    await m.getDb().update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, tenant.id));
    await expect(insert({}, tenant.id)).rejects.toThrow(RLS);
  });

  it('lets only the portrait’s editors read and review submissions', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const editorView = await submissionsOf(people.editorA, cityA.id);
    expect(editorView.length).toBeGreaterThanOrEqual(2);
    expect(editorView.every((s) => s.status === 'new')).toBe(true);
    expect(await submissionsOf(people.viewerA, cityA.id)).toHaveLength(0);
    expect(await submissionsOf(people.editorB, cityA.id)).toHaveLength(0);

    // Nobody else can change or remove one: their UPDATE and DELETE match no rows.
    const target = editorView[0]!.id;
    for (const who of [null, people.resident, people.viewerA, people.editorB]) {
      const updated = await as(who, (tx) =>
        tx
          .update(m.involvementSubmissions)
          .set({ status: 'approved' })
          .where(eq(m.involvementSubmissions.id, target))
          .returning({ id: m.involvementSubmissions.id }),
      );
      expect(updated).toHaveLength(0);
      const deleted = await as(who, (tx) =>
        tx.delete(m.involvementSubmissions).where(eq(m.involvementSubmissions.id, target)).returning({ id: m.involvementSubmissions.id }),
      );
      expect(deleted).toHaveLength(0);
    }
    const reviewed = await as(people.editorA, (tx) =>
      tx
        .update(m.involvementSubmissions)
        .set({ status: 'declined', reviewedBy: people.editorA, reviewedAt: new Date(), reviewNote: 'not local' })
        .where(eq(m.involvementSubmissions.id, target))
        .returning({ status: m.involvementSubmissions.status }),
    );
    expect(reviewed).toEqual([{ status: 'declined' }]);
  });

  it('gives anyone the rate-limit counts, and nothing more', async () => {
    const { sql } = await import('drizzle-orm');
    const email = `${uniq()}@example.org`;
    const m = await import('@deep-fryer/db');
    await as(null, (tx) => tx.insert(m.involvementSubmissions).values(submission(cityB.id, { email, ipHash: 'b'.repeat(32) })));
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [counts] = await as(null, (tx) =>
      tx.execute<{ by_ip: string; by_email: string }>(
        sql`SELECT * FROM involvement_submission_counts(${cityB.id}::uuid, ${'b'.repeat(32)}, ${email.toUpperCase()}, ${hourAgo}::timestamptz, ${hourAgo}::timestamptz)`,
      ),
    );
    expect({ byIp: Number(counts!.by_ip), byEmail: Number(counts!.by_email) }).toEqual({ byIp: 1, byEmail: 1 });
  });

  it('shows the public published listings only, and so does the public page to staff', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
    const listingsAs = (userId: string | null) =>
      as(userId, (tx) =>
        tx.select({ name: m.involvementListings.name }).from(m.involvementListings).where(eq(m.involvementListings.tenantId, cityA.id)),
      );
    expect(names(await listingsAs(null))).toEqual(['Food bank shifts']);
    expect(names(await listingsAs(people.resident))).toEqual(['Food bank shifts']);
    // Members may read drafts (for the admin pages)…
    expect(names(await listingsAs(people.viewerA))).toEqual(['Draft listing', 'Food bank shifts']);
    // …and only editors write them.
    await expect(
      as(people.viewerA, (tx) =>
        tx.insert(m.involvementListings).values({ tenantId: cityA.id, name: 'Viewer’s', description: 'x', kind: 'other' }),
      ),
    ).rejects.toThrow(RLS);
    await expect(
      as(null, (tx) => tx.insert(m.involvementListings).values({ tenantId: cityA.id, name: 'Anon’s', description: 'x', kind: 'other' })),
    ).rejects.toThrow(RLS);

    // The public read path, as an anonymous visitor and as an editor.
    const { publishedListings } = await import('./involvement');
    signedIn = null;
    expect((await publishedListings(cityA.slug)).map((l) => l.name)).toEqual(['Food bank shifts']);
    signedIn = people.editorA;
    const view = await publishedListings(cityA.slug);
    expect(view).toEqual([
      expect.objectContaining({ name: 'Food bank shifts', kind: 'volunteer', dimension_slugs: ['food'], link_checked_at: null }),
    ]);
    signedIn = null;
    expect(await publishedListings(uniq())).toEqual([]);
  });
});
