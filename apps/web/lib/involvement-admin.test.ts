import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INVOLVEMENT_LIMITS, involvementListingInputSchema } from '@deep-fryer/core';
import {
  asSubmissionStatus,
  listingDraftFromSubmission,
  trimToLimit,
  type SubmissionForListing,
} from './involvement-admin';

/**
 * The staff reads for getting involved (SPEC-v6 §4.3).
 *
 * The pure half — which tab a query names, and the listing form's starting
 * values when staff approve a submission — needs no database. The other
 * half runs against the dev database as signed-in people (not dev mode), so
 * the enforced `deep_fryer_app` role and migration 0010's policies decide
 * what each person reads: an editor sees the queue with its counts, and
 * anyone below editor sees no submissions at all.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    signedIn ? { user: { id: signedIn, email: `${signedIn}@example.gov`, displayName: null, isStaff: false } } : null,
  ),
}));

describe('asSubmissionStatus', () => {
  it('reads the tab from ?status= and falls back to the queue of new submissions', () => {
    expect(asSubmissionStatus('spam')).toBe('spam');
    expect(asSubmissionStatus(['declined', 'new'])).toBe('declined');
    expect(asSubmissionStatus(undefined)).toBe('new');
    expect(asSubmissionStatus('everything')).toBe('new');
    expect(asSubmissionStatus('')).toBe('new');
  });
});

describe('trimToLimit', () => {
  it('leaves text within the limit alone, apart from surrounding space', () => {
    expect(trimToLimit('  Join a tenant association.  ', 600)).toBe('Join a tenant association.');
  });

  it('cuts long text at a word boundary and marks the cut', () => {
    const text = 'word '.repeat(200); // 1000 characters
    const cut = trimToLimit(text, 600);
    expect(cut.length).toBeLessThanOrEqual(600);
    expect(cut.endsWith('word…')).toBe(true);
  });

  it('cuts one very long word where it is, and never splits an emoji', () => {
    expect(trimToLimit('x'.repeat(700), 600)).toBe(`${'x'.repeat(599)}…`);
    // 598 letters then an emoji (two UTF-16 units) straddling the cut at 599.
    const cut = trimToLimit(`${'a'.repeat(598)}😀${'b'.repeat(50)}`, 600);
    expect(cut).toBe(`${'a'.repeat(598)}…`);
  });
});

describe('listingDraftFromSubmission', () => {
  const organization: SubmissionForListing = {
    kind: 'listing',
    dimensionSlug: 'housing',
    orgName: 'Riverside Tenants Union',
    pitch: 'Tenants meet monthly to fight unlawful evictions; anyone can join.',
    website: 'https://riverside-tenants.example.org',
  };

  it('prefills an organization as a "join a group" listing for its dimension, unpublished', () => {
    const draft = listingDraftFromSubmission(organization);
    expect(draft).toEqual({
      name: 'Riverside Tenants Union',
      description: 'Tenants meet monthly to fight unlawful evictions; anyone can join.',
      url: 'https://riverside-tenants.example.org',
      phone: null,
      kind: 'organize',
      dimension_slugs: ['housing'],
      source_url: null,
      display_order: 0,
      published: false,
    });
    // As prefilled, it is a listing staff could save without changes.
    expect(involvementListingInputSchema.safeParse(draft).success).toBe(true);
  });

  it('drops a website that is not https, and a dimension the framework does not know', () => {
    const draft = listingDraftFromSubmission({ ...organization, website: 'http://insecure.example.org', dimensionSlug: 'vibes' });
    expect(draft.url).toBeNull();
    expect(draft.dimension_slugs).toEqual([]);
  });

  it('leaves a suggestion for staff to name and classify', () => {
    const draft = listingDraftFromSubmission({
      kind: 'suggestion',
      dimensionSlug: null,
      orgName: null,
      pitch: `Hold budget hearings in the evening. ${'More detail. '.repeat(100)}`,
      website: null,
    });
    expect(draft).toMatchObject({ name: '', kind: 'other', dimension_slugs: [], url: null });
    expect(draft.description.length).toBeLessThanOrEqual(INVOLVEMENT_LIMITS.description);
    expect(draft.description.startsWith('Hold budget hearings in the evening.')).toBe(true);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('involvement admin reads under row-level security', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenant: import('@deep-fryer/db').Tenant;
  const people: Record<'editor' | 'moderator' | 'outsider', string> = { editor: '', moderator: '', outsider: '' };
  const ids: Record<'old' | 'recent' | 'declined', string> = { old: randomUUID(), recent: randomUUID(), declined: randomUUID() };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    ({ tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Queue City' }));
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['editor', 'moderator', 'outsider'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      if (role !== 'outsider') await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }

    // Three submissions from the public form (anonymous, as the form runs),
    // then a staff decision on one, made directly to set up the fixture.
    const base = {
      tenantId: tenant.id,
      kind: 'listing' as const,
      about: 'A neighborhood group.',
      pitch: 'Come to our meetings.',
      contactName: 'Ada',
      email: 'ada@example.org',
      locale: 'es',
      ipHash: 'test-hash',
    };
    await m.withAuthContext(db, null, (tx) =>
      tx.insert(m.involvementSubmissions).values([
        { ...base, id: ids.old, orgName: 'Older Group', createdAt: new Date(Date.now() - 60_000) },
        { ...base, id: ids.recent, orgName: 'Newer Group' },
        { ...base, id: ids.declined, orgName: 'Declined Group' },
      ]),
    );
    const { eq } = await import('drizzle-orm');
    await db
      .update(m.involvementSubmissions)
      .set({ status: 'declined', reviewNote: 'Not in the city.' })
      .where(eq(m.involvementSubmissions.id, ids.declined));

    // Listings: a draft and a published one, out of display order on purpose.
    await db.insert(m.involvementListings).values([
      { tenantId: tenant.id, name: 'Zeta Volunteers', description: 'Give time.', kind: 'volunteer', displayOrder: 0 },
      { tenantId: tenant.id, name: 'Alpha Board', description: 'Have your say.', kind: 'civic', displayOrder: 5, published: true },
      { tenantId: tenant.id, name: 'Beta Services', description: 'Get help.', kind: 'services', displayOrder: 0 },
    ]);
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Listings and submissions go with the portrait (ON DELETE CASCADE).
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  it('gives an editor the queue: counts per status, newest first, every listing in residents’ order', async () => {
    const { involvementAdminView } = await import('./involvement-admin');
    signedIn = people.editor;
    const view = await involvementAdminView(tenant, 'new');
    expect(view.counts).toEqual({ new: 2, approved: 0, declined: 1, spam: 0 });
    expect(view.submissions.map((s) => s.orgName)).toEqual(['Newer Group', 'Older Group']);
    // Contact details reach staff; the address hash (rate limits only) does not.
    expect(view.submissions[0]).toMatchObject({ contactName: 'Ada', email: 'ada@example.org', locale: 'es', status: 'new' });
    expect(view.submissions[0]).not.toHaveProperty('ipHash');
    // Drafts included; order, then name.
    expect(view.listings.map((l) => [l.name, l.published])).toEqual([
      ['Beta Services', false],
      ['Zeta Volunteers', false],
      ['Alpha Board', true],
    ]);
    // No emergency settings saved: staff times are on New York's clock.
    expect(view.timeZone).toBe('America/New_York');

    const declined = await involvementAdminView(tenant, 'declined');
    expect(declined.submissions.map((s) => [s.orgName, s.reviewNote])).toEqual([['Declined Group', 'Not in the city.']]);
  });

  it('counts new submissions for editors only', async () => {
    const { countNewSubmissions, involvementAdminView } = await import('./involvement-admin');
    signedIn = people.editor;
    expect(await countNewSubmissions(tenant.id)).toBe(2);

    // A moderator is a member — drafts are visible — but submissions are editor-only.
    signedIn = people.moderator;
    expect(await countNewSubmissions(tenant.id)).toBe(0);
    const modView = await involvementAdminView(tenant, 'new');
    expect(modView.submissions).toEqual([]);
    expect(modView.listings).toHaveLength(3);

    // Someone from outside the portrait: no submissions, published listings only.
    signedIn = people.outsider;
    expect(await countNewSubmissions(tenant.id)).toBe(0);
    const outsiderView = await involvementAdminView(tenant, 'new');
    expect(outsiderView.counts).toEqual({ new: 0, approved: 0, declined: 0, spam: 0 });
    expect(outsiderView.listings.map((l) => l.name)).toEqual(['Alpha Board']);
  });
});
