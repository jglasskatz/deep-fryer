import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';
import { setPortraitFeatures } from './test-features';

/**
 * Staff curation of getting involved (SPEC-v6 §4.3), against the dev
 * database as signed-in people (not dev mode): userDb runs as the enforced
 * `deep_fryer_app` role, so every write here passes — or fails — migration
 * 0010's row-level security as well as the app's role check.
 *
 * Submissions are filed the way the public form files them: anonymously,
 * through the insert-only policy, without reading the row back. Then:
 *
 * - approval creates the listing and marks the submission approved in one
 *   transaction, refuses a second approval, and rolls back whole when the
 *   listing cannot be created;
 * - decline / spam / back-to-new keep the review fields consistent;
 * - listings are validated by the shared core schema, names are unique per
 *   portrait (ignoring case), and an edit to the link clears "link checked";
 * - only editors act: a viewer and a stranger are refused by the app, and
 *   the database refuses the stranger on its own as well.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user. The session is read
// through the pooled client, as in production (test/database-session.ts).
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `iv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const NEEDS_EDITOR = { ok: false, error: 'This needs the editor role on this portrait.' };

describe.skipIf(!hasDb)('involvement admin actions under row-level security', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';
  const people: Record<'editor' | 'viewer' | 'outsider', string> = { editor: '', viewer: '', outsider: '' };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Involved City' });
    await setPortraitFeatures(tenant.id, { involvement: true });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['editor', 'viewer', 'outsider'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      if (role !== 'outsider') await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Listings, submissions, and audit entries go with the portrait (ON DELETE CASCADE).
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  /**
   * File a submission as the public form does: anonymous, insert-only. The
   * submitter cannot read the row back (no RETURNING), so the id is chosen
   * here to find it again.
   */
  async function submitAnonymously(fields: { orgName?: string; kind?: 'listing' | 'suggestion' } = {}) {
    const m = await import('@deep-fryer/db');
    const id = randomUUID();
    const kind = fields.kind ?? 'listing';
    await m.withAuthContext(m.getDb(), null, (tx) =>
      tx.insert(m.involvementSubmissions).values({
        id,
        tenantId,
        kind,
        dimensionSlug: 'housing',
        orgName: kind === 'listing' ? (fields.orgName ?? `Tenants United ${uniq()}`) : null,
        about: kind === 'listing' ? 'A citywide tenants’ union.' : null,
        pitch: 'Members learn their rights and organize building by building.',
        website: 'https://tenants.example.org',
        contactName: 'Grace Lee',
        email: 'grace@example.org',
        phone: '(212) 555-0100',
        locale: 'es',
        ipHash: 'test-hash',
      }),
    );
    return id;
  }

  async function submissionRow(id: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.involvementSubmissions).where(eq(m.involvementSubmissions.id, id));
    return row!;
  }

  async function listingsNamed(name: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.involvementListings)
      .where(and(eq(m.involvementListings.tenantId, tenantId), eq(m.involvementListings.name, name)));
  }

  const listing = (name: string) => ({
    name,
    description: 'Join a tenants’ union: learn your rights and organize your building.',
    url: 'https://tenants.example.org/join',
    kind: 'organize' as const,
    dimension_slugs: ['housing'],
  });

  it('approves a submission into a listing in one step, and only once', async () => {
    const a = await import('./involvement-admin-actions');
    const submissionId = await submitAnonymously();
    const name = `Tenants Union ${uniq()}`;

    signedIn = people.editor;
    const res = await a.approveSubmission({ tenantSlug, submissionId, listing: listing(name) });
    expect(res).toMatchObject({ ok: true });
    const listingId = (res as { ok: true; data: { listingId: string } }).data.listingId;

    const [created] = await listingsNamed(name);
    expect(created).toMatchObject({
      id: listingId,
      tenantId,
      kind: 'organize',
      dimensionSlugs: ['housing'],
      url: 'https://tenants.example.org/join',
      published: false,
      submissionId,
      createdBy: people.editor,
      linkCheckedAt: null,
    });
    const after = await submissionRow(submissionId);
    expect(after).toMatchObject({ status: 'approved', reviewedBy: people.editor, listingId });
    expect(after.reviewedAt).toBeInstanceOf(Date);

    // The audit trail records the decision — never the submitter's contact details.
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const log = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, submissionId)).orderBy(m.auditLog.id);
    expect(log.map((l) => [l.entity, l.action, l.userId])).toEqual([['involvement_submission', 'approve', people.editor]]);
    const everything = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.tenantId, tenantId));
    expect(JSON.stringify(everything.map((l) => [l.before, l.after]))).not.toMatch(/grace@example\.org|555-0100/);

    // A second reviewer pressing Approve is told, and nothing more is created.
    expect(await a.approveSubmission({ tenantSlug, submissionId, listing: listing(`${name} again`) })).toEqual({
      ok: false,
      error: 'This submission was already approved.',
    });
    expect(await listingsNamed(`${name} again`)).toHaveLength(0);
    expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'declined' })).toEqual({
      ok: false,
      error: 'This submission was already approved. Unpublish or delete its listing instead.',
    });
  });

  it('rolls the approval back whole when the listing cannot be created', async () => {
    const a = await import('./involvement-admin-actions');
    signedIn = people.editor;
    const taken = `Food Bank ${uniq()}`;
    expect(await a.saveListing({ tenantSlug, listing: { ...listing(taken), kind: 'volunteer' } })).toMatchObject({ ok: true });

    const submissionId = await submitAnonymously();
    // Same name in other letters: refused, with a reason staff can act on.
    const res = await a.approveSubmission({ tenantSlug, submissionId, listing: listing(taken.toUpperCase()) });
    expect(res).toEqual({
      ok: false,
      error: `A listing named “${taken.toUpperCase()}” already exists on this portrait. Edit that one, or choose another name.`,
    });
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'new', reviewedBy: null, reviewedAt: null, listingId: null });

    // Invalid listing input is refused before anything is touched.
    expect(
      await a.approveSubmission({ tenantSlug, submissionId, listing: { ...listing(`X ${uniq()}`), url: 'http://tenants.example.org' } }),
    ).toEqual({ ok: false, error: 'url: must be a full https:// link' });
    expect((await submissionRow(submissionId)).status).toBe('new');
  });

  it('declines or marks spam with a note, and moves a mistake back to New', async () => {
    const a = await import('./involvement-admin-actions');
    signedIn = people.editor;
    const submissionId = await submitAnonymously({ kind: 'suggestion' });

    expect(
      await a.reviewSubmission({ tenantSlug, submissionId, status: 'declined', note: 'x'.repeat(1001) }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/under 1000 characters/) });
    expect(
      await a.reviewSubmission({ tenantSlug, submissionId, status: 'approved' as never }),
    ).toMatchObject({ ok: false });

    expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'spam', note: '  Advertising.  ' })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'spam', reviewNote: 'Advertising.', reviewedBy: people.editor });

    // Already decided: change it only by moving it back first.
    expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'declined' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already marked as spam/),
    });
    expect(await a.approveSubmission({ tenantSlug, submissionId, listing: listing(`Y ${uniq()}`) })).toEqual({
      ok: false,
      error: 'This submission was already marked as spam.',
    });

    expect(await a.reopenSubmission({ tenantSlug, submissionId })).toMatchObject({ ok: true });
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'new', reviewNote: null, reviewedBy: null, reviewedAt: null });
    expect(await a.reopenSubmission({ tenantSlug, submissionId })).toEqual({ ok: false, error: 'This submission is already new.' });

    // A blank note is no note.
    expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'declined', note: '   ' })).toMatchObject({ ok: true });
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'declined', reviewNote: null });
  });

  it('curates listings: validation, unique names, publishing, link checks, delete', async () => {
    const a = await import('./involvement-admin-actions');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    signedIn = people.editor;
    const name = `Parks Stewards ${uniq()}`;
    const base = { ...listing(name), kind: 'volunteer' as const, dimension_slugs: ['biodiversity-loss'] };

    // The shared core schema refuses bad input with its reason.
    expect(await a.saveListing({ tenantSlug, listing: { ...base, description: '  ' } })).toEqual({
      ok: false,
      error: 'description: say what people can do',
    });
    expect(await a.saveListing({ tenantSlug, listing: { ...base, url: 'javascript:alert(1)' } })).toMatchObject({ ok: false });
    expect(await a.saveListing({ tenantSlug, listing: { ...base, dimension_slugs: ['vibes'] } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a doughnut dimension/),
    });
    expect(await a.saveListing({ tenantSlug, listing: { ...base, phone: 'call us' } })).toMatchObject({ ok: false });

    const created = await a.saveListing({ tenantSlug, listing: base });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { ok: true; data: { id: string } }).data.id;
    expect(await a.saveListing({ tenantSlug, listing: base })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });

    // Anonymous residents read published listings only (the public-read policy).
    const anonymousNames = () =>
      m.withAuthContext(m.getDb(), null, (tx) =>
        tx.select({ name: m.involvementListings.name }).from(m.involvementListings).where(eq(m.involvementListings.tenantId, tenantId)),
      );
    expect((await anonymousNames()).map((r) => r.name)).not.toContain(name);
    expect(await a.setListingPublished({ tenantSlug, id, published: true })).toMatchObject({ ok: true });
    expect((await anonymousNames()).map((r) => r.name)).toContain(name);

    expect(await a.markLinkChecked({ tenantSlug, id })).toMatchObject({ ok: true });
    let [row] = await m.getDb().select().from(m.involvementListings).where(eq(m.involvementListings.id, id));
    expect(row!.linkCheckedAt).toBeInstanceOf(Date);

    // An edit keeps the stamp while the link is the same, clears it when the link changes,
    // and never changes visibility (an edit form's stale `published` is ignored).
    expect(
      await a.saveListing({ tenantSlug, id, listing: { ...base, description: 'Plant and care for street trees.', published: false } }),
    ).toMatchObject({ ok: true });
    [row] = await m.getDb().select().from(m.involvementListings).where(eq(m.involvementListings.id, id));
    expect(row).toMatchObject({ description: 'Plant and care for street trees.', published: true });
    expect(row!.linkCheckedAt).toBeInstanceOf(Date);
    expect(await a.saveListing({ tenantSlug, id, listing: { ...base, url: 'https://parks.example.org/stewards' } })).toMatchObject({ ok: true });
    [row] = await m.getDb().select().from(m.involvementListings).where(eq(m.involvementListings.id, id));
    expect(row).toMatchObject({ url: 'https://parks.example.org/stewards', linkCheckedAt: null });

    // A listing with no link has nothing to check.
    const phoneOnly = await a.saveListing({
      tenantSlug,
      listing: { ...base, name: `Hotline ${uniq()}`, url: '', phone: '311', kind: 'services' },
    });
    const phoneOnlyId = (phoneOnly as { ok: true; data: { id: string } }).data.id;
    expect(await a.markLinkChecked({ tenantSlug, id: phoneOnlyId })).toEqual({ ok: false, error: 'This listing has no link to check.' });

    expect(await a.deleteListing({ tenantSlug, id })).toMatchObject({ ok: true });
    expect(await a.deleteListing({ tenantSlug, id })).toEqual({ ok: false, error: 'Unknown listing.' });
    const log = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, id)).orderBy(m.auditLog.id);
    expect(log.map((l) => l.action)).toEqual(['create', 'publish', 'link_checked', 'update', 'update', 'delete']);
  });

  it('unlinks a deleted listing from the submission it was approved from', async () => {
    const a = await import('./involvement-admin-actions');
    signedIn = people.editor;
    const submissionId = await submitAnonymously();
    const res = await a.approveSubmission({ tenantSlug, submissionId, listing: listing(`Block Association ${uniq()}`) });
    const listingId = (res as { ok: true; data: { listingId: string } }).data.listingId;
    expect(await a.deleteListing({ tenantSlug, id: listingId })).toMatchObject({ ok: true });
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'approved', listingId: null });
  });

  it('refuses an editor while Get involved is off for the portrait (SPEC-v7 §3)', async () => {
    const a = await import('./involvement-admin-actions');
    const submissionId = await submitAnonymously();
    const off = { ok: false, error: 'This feature is turned off for this portrait. An owner can turn it on in Settings.' };
    await setPortraitFeatures(tenantId, { involvement: false });
    try {
      signedIn = people.editor;
      expect(await a.approveSubmission({ tenantSlug, submissionId, listing: listing(`Flag Off ${uniq()}`) })).toEqual(off);
      expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'spam' })).toEqual(off);
      expect(await a.saveListing({ tenantSlug, listing: listing(`Flag Off ${uniq()}`) })).toEqual(off);
    } finally {
      await setPortraitFeatures(tenantId, { involvement: true });
    }
    expect(await submissionRow(submissionId)).toMatchObject({ status: 'new' });
    expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'spam' })).toMatchObject({ ok: true });
    signedIn = null;
  });

  it('lets only editors decide, and the database agrees on its own', async () => {
    const a = await import('./involvement-admin-actions');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const submissionId = await submitAnonymously();
    const name = `Not Approved ${uniq()}`;

    for (const who of [people.viewer, people.outsider, null]) {
      signedIn = who;
      expect(await a.approveSubmission({ tenantSlug, submissionId, listing: listing(name) })).toEqual(NEEDS_EDITOR);
      expect(await a.reviewSubmission({ tenantSlug, submissionId, status: 'spam' })).toEqual(NEEDS_EDITOR);
      expect(await a.saveListing({ tenantSlug, listing: listing(name) })).toEqual(NEEDS_EDITOR);
    }

    // Past the app's check, row-level security still refuses a stranger:
    // they cannot read the submission (it holds contact details), change it,
    // or write a listing.
    const asOutsider = <T>(fn: (tx: import('@deep-fryer/db').DbExecutor) => Promise<T>) =>
      m.withAuthContext(m.getDb(), people.outsider, fn);
    expect(
      await asOutsider((tx) => tx.select().from(m.involvementSubmissions).where(eq(m.involvementSubmissions.id, submissionId))),
    ).toEqual([]);
    expect(
      await asOutsider((tx) =>
        tx
          .update(m.involvementSubmissions)
          .set({ status: 'approved', reviewedBy: people.outsider })
          .where(eq(m.involvementSubmissions.id, submissionId))
          .returning({ id: m.involvementSubmissions.id }),
      ),
    ).toEqual([]);
    await expect(
      asOutsider((tx) =>
        tx.insert(m.involvementListings).values({ tenantId, name, description: 'Sneaky.', kind: 'other', published: true }),
      ),
    ).rejects.toThrow(/row-level security/);

    expect(await submissionRow(submissionId)).toMatchObject({ status: 'new', reviewedBy: null, listingId: null });
    expect(await listingsNamed(name)).toHaveLength(0);
  });

  it('runs every write on its own transaction, audit entries included', async () => {
    // Each action audits inside its userDb transaction, and audit() reads its
    // actor with getAuth(). In a server action that was a fresh session read
    // on the pooled client (React's cache() does not memoize there), waiting
    // for a second connection while the transaction held the first — and,
    // for the submission actions, while it held the submission's row lock.
    // On a one-connection pool, one request waited forever
    // (test/one-connection.ts).
    type Actions = typeof import('./involvement-admin-actions');
    const run = <T>(fn: (a: Actions) => Promise<T>) =>
      onOneConnection(async () => fn(await import('./involvement-admin-actions')));
    const ok = { ok: true, data: undefined };
    signedIn = people.editor;

    const name = `Community Garden ${uniq()}`;
    const created = await run((a) => a.saveListing({ tenantSlug, listing: { ...listing(name), kind: 'volunteer' } }));
    expect(created).toMatchObject({ ok: true });
    const id = (created as { ok: true; data: { id: string } }).data.id;
    expect(await run((a) => a.saveListing({ tenantSlug, id, listing: { ...listing(name), kind: 'volunteer', description: 'Grow food together.' } }))).toEqual({
      ok: true,
      data: { id },
    });
    expect(await run((a) => a.setListingPublished({ tenantSlug, id, published: true }))).toEqual(ok);
    expect(await run((a) => a.markLinkChecked({ tenantSlug, id }))).toEqual(ok);
    expect(await run((a) => a.deleteListing({ tenantSlug, id }))).toEqual(ok);

    const declined = await submitAnonymously();
    expect(await run((a) => a.reviewSubmission({ tenantSlug, submissionId: declined, status: 'declined' }))).toEqual(ok);
    expect(await run((a) => a.reopenSubmission({ tenantSlug, submissionId: declined }))).toEqual(ok);
    const approved = await submitAnonymously();
    const res = await run((a) => a.approveSubmission({ tenantSlug, submissionId: approved, listing: listing(`Tenants ${uniq()}`) }));
    expect(res).toMatchObject({ ok: true });
    const listingId = (res as { ok: true; data: { listingId: string } }).data.listingId;

    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const log = await m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(inArray(m.auditLog.entityId, [id, declined, approved, listingId]))
      .orderBy(m.auditLog.id);
    expect(log.map((l) => [l.entity, l.action, l.userId])).toEqual([
      ['involvement_listing', 'create', people.editor],
      ['involvement_listing', 'update', people.editor],
      ['involvement_listing', 'publish', people.editor],
      ['involvement_listing', 'link_checked', people.editor],
      ['involvement_listing', 'delete', people.editor],
      ['involvement_submission', 'decline', people.editor],
      ['involvement_submission', 'reopen', people.editor],
      ['involvement_listing', 'create', people.editor],
      ['involvement_submission', 'approve', people.editor],
    ]);
    signedIn = null;
  });
});
