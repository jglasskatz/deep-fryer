import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * Comment moderation end to end (SPEC-v6 §3.1–3.3) for signed-in people, not
 * dev mode: userDb runs as the enforced `deep_fryer_app` role, so every
 * post, read, approval, and decline below passes the app-layer checks and
 * the database's row-level security together, through the real actions and
 * the real thread query.
 *
 * The portrait requires approval for first posts. A resident's first
 * comment is held: only they and the moderator see it (with its text), the
 * public sees nothing. The moderator declines it, then approves it; a later
 * removal leaves the public placeholder; the moderator's own comment is
 * never held and carries the staff flag; the queue lists what is waiting.
 */

// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user. The session is read
// through the pooled client, as in production (test/database-session.ts).
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('comment moderation under row-level security', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';
  let dimensionId = '';
  const people: Record<'moderator' | 'resident' | 'neighbor', string> = { moderator: '', resident: '', neighbor: '' };
  let heldId = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Moderation City' });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;

    // Residents can only read (and so comment on) a published dimension.
    dimensionId = dimensions[0]!.dimensionId;
    const version = (await m.latestVersion(db, dimensionId))!;
    await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, version.id));
    await db.update(m.dimensions).set({ publishedVersionId: version.id }).where(eq(m.dimensions.id, dimensionId));

    // The policy under test: first posts need approval. Discussion is also
    // switched on explicitly, since it is a feature a new portrait starts
    // without (SPEC-v7 §3).
    const merge = async (key: string, patch: Record<string, unknown>) => {
      const where = and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, key));
      const [row] = await db.select().from(m.tenantConfig).where(where);
      const value = { ...((row?.value as object | undefined) ?? {}), ...patch };
      await db
        .insert(m.tenantConfig)
        .values({ tenantId: tenant.id, key, value })
        .onConflictDoUpdate({ target: [m.tenantConfig.tenantId, m.tenantConfig.key], set: { value } });
    };
    await merge('review_policy', { first_post_requires_approval: true });
    await merge('features', { discussion: true });

    const [moderator] = await db.insert(m.users).values({ email: `${uniq()}@moderator.example.gov`, displayName: 'Parks moderator' }).returning();
    const [resident] = await db.insert(m.users).values({ email: `${uniq()}@resident.example.org` }).returning();
    const [neighbor] = await db.insert(m.users).values({ email: `${uniq()}@neighbor.example.org` }).returning();
    people.moderator = moderator!.id;
    people.resident = resident!.id;
    people.neighbor = neighbor!.id;
    cleanup.userIds.push(moderator!.id, resident!.id, neighbor!.id);
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: moderator!.id, role: 'moderator' });
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Comments and their moderation records cascade with the tenant.
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  /** The thread as `who` sees it (null: an anonymous visitor). */
  async function threadAs(who: string | null, isModerator = false) {
    const { dimensionThread } = await import('./discussion');
    signedIn = who;
    return dimensionThread(tenantId, dimensionId, who, 'new', { isModerator });
  }

  async function commentRow(id: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.comments).where(eq(m.comments.id, id));
    return row!;
  }

  async function actionLog(id: string) {
    const m = await import('@deep-fryer/db');
    const { asc, eq } = await import('drizzle-orm');
    const rows = await m
      .getDb()
      .select()
      .from(m.moderationActions)
      .where(eq(m.moderationActions.commentId, id))
      .orderBy(asc(m.moderationActions.ts));
    return rows.map((r) => [r.action, r.actorId, r.reason]);
  }

  it('holds a resident’s first comment where only they and the moderators can see it', async () => {
    const a = await import('./discussion-actions');
    const { countHeldComments, SYSTEM_ACTOR_ID } = await import('./discussion');
    signedIn = people.resident;
    const posted = await a.postComment({ tenantSlug, dimensionId, body: 'Please add protected bike lanes on 4th Avenue.' });
    expect(posted).toMatchObject({ ok: true, data: { pendingApproval: true } });
    heldId = (posted as { ok: true; data: { commentId: string } }).data.commentId;

    expect(await commentRow(heldId)).toMatchObject({ removedBy: SYSTEM_ACTOR_ID });
    expect(await actionLog(heldId)).toEqual([['remove', SYSTEM_ACTOR_ID, 'pending first-post approval']]);

    // The public and other residents: nothing at all, not even a placeholder.
    expect(await threadAs(null)).toEqual([]);
    expect(await threadAs(people.neighbor)).toEqual([]);
    // Its author: the text, marked held.
    const own = await threadAs(people.resident);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: heldId, state: 'held', mine: true, staff: false, body: 'Please add protected bike lanes on 4th Avenue.' });
    // A moderator: the text too, to decide on.
    const modView = await threadAs(people.moderator, true);
    expect(modView[0]).toMatchObject({ id: heldId, state: 'held', mine: false, body: 'Please add protected bike lanes on 4th Avenue.' });

    signedIn = people.moderator;
    expect(await countHeldComments(tenantId)).toBe(1);
  });

  it('keeps residents from approving, replying to, or voting on a held comment', async () => {
    const a = await import('./discussion-actions');
    signedIn = people.resident;
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'approve' })).toEqual({
      ok: false,
      error: 'This needs the moderator role on this portrait.',
    });
    expect(await a.postComment({ tenantSlug, dimensionId, parentId: heldId, body: 'and on 5th' })).toEqual({
      ok: false,
      error: 'You can reply once this comment is approved.',
    });
    signedIn = people.neighbor;
    expect(await a.voteComment({ tenantSlug, commentId: heldId, vote: 1 })).toEqual({
      ok: false,
      error: 'Only published comments can be voted on.',
    });
  });

  it('declines, then approves, through the database policies — and refuses transitions that do not apply', async () => {
    const a = await import('./discussion-actions');
    const { SYSTEM_ACTOR_ID } = await import('./discussion');
    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'restore' })).toEqual({
      ok: false,
      error: 'This comment is awaiting approval — approve or decline it.',
    });
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'decline' })).toEqual({
      ok: true,
      data: { state: 'declined' },
    });
    expect(await commentRow(heldId)).toMatchObject({ removedBy: people.moderator });
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'decline' })).toEqual({
      ok: false,
      error: 'This comment was already declined.',
    });

    // Declined: still nothing for the public; the author and moderators see it marked declined.
    expect(await threadAs(null)).toEqual([]);
    expect((await threadAs(people.resident))[0]).toMatchObject({ state: 'declined', body: expect.any(String) });
    expect((await threadAs(people.moderator, true))[0]).toMatchObject({ state: 'declined', body: expect.any(String) });

    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'approve' })).toEqual({
      ok: true,
      data: { state: 'visible' },
    });
    expect(await commentRow(heldId)).toMatchObject({ removedAt: null, removedBy: null });
    const publicView = await threadAs(null);
    expect(publicView).toHaveLength(1);
    expect(publicView[0]).toMatchObject({ id: heldId, state: 'visible', body: 'Please add protected bike lanes on 4th Avenue.' });
    expect(publicView[0]!.author).toMatch(/^resident-[0-9a-f]{6}$/);

    expect(await actionLog(heldId)).toEqual([
      ['remove', SYSTEM_ACTOR_ID, 'pending first-post approval'],
      ['remove', people.moderator, 'declined first post'],
      ['restore', people.moderator, 'approved first post'],
    ]);

    // Approved, so later comments by the same resident are published straight away.
    signedIn = people.resident;
    expect(await a.postComment({ tenantSlug, dimensionId, parentId: heldId, body: 'Thank you!' })).toMatchObject({
      ok: true,
      data: { pendingApproval: false },
    });
  });

  it('removes a published comment behind the placeholder, which moderators can still read and restore', async () => {
    const a = await import('./discussion-actions');
    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'approve' })).toEqual({
      ok: false,
      error: 'This comment is already public.',
    });
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'remove', reason: 'personal attack' })).toEqual({
      ok: true,
      data: { state: 'removed' },
    });

    const publicView = await threadAs(null);
    expect(publicView[0]).toMatchObject({ id: heldId, state: 'removed', body: null });
    // The reply under it stays, so the conversation still reads.
    expect(publicView[0]!.replies.map((r) => r.body)).toEqual(['Thank you!']);
    expect((await threadAs(people.resident))[0]).toMatchObject({ state: 'removed', body: null });
    expect((await threadAs(people.moderator, true))[0]).toMatchObject({ state: 'removed', body: 'Please add protected bike lanes on 4th Avenue.' });

    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'decline' })).toEqual({
      ok: false,
      error: 'This comment is already removed.',
    });
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'restore' })).toEqual({
      ok: true,
      data: { state: 'visible' },
    });
    expect((await threadAs(null))[0]).toMatchObject({ state: 'visible', body: 'Please add protected bike lanes on 4th Avenue.' });
  });

  it('never holds a moderator’s comment, labels it staff, and refuses self-moderation plainly', async () => {
    const a = await import('./discussion-actions');
    signedIn = people.moderator;
    const posted = await a.postComment({ tenantSlug, dimensionId, body: 'The DOT is studying 4th Avenue this winter.' });
    expect(posted).toMatchObject({ ok: true, data: { pendingApproval: false } });
    const id = (posted as { ok: true; data: { commentId: string } }).data.commentId;

    const staffComment = (await threadAs(null)).find((c) => c.id === id);
    expect(staffComment).toMatchObject({ author: 'Parks moderator', staff: true, state: 'visible' });

    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: id, action: 'remove' })).toEqual({
      ok: false,
      error: 'Another moderator needs to review your own comment.',
    });
  });

  it('refuses posting, voting, and moderating while discussion is off for the portrait (SPEC-v7 §3)', async () => {
    const a = await import('./discussion-actions');
    const { setPortraitFeatures } = await import('./test-features');
    const off = { ok: false, error: 'This feature is turned off for this portrait. An owner can turn it on in Settings.' };
    await setPortraitFeatures(tenantId, { discussion: false });
    try {
      signedIn = people.neighbor;
      expect(await a.postComment({ tenantSlug, dimensionId, body: 'Is anyone reading this?' })).toEqual(off);
      expect(await a.voteComment({ tenantSlug, commentId: heldId, vote: 1 })).toEqual(off);
      signedIn = people.moderator;
      expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'remove', reason: 'off-topic' })).toEqual(off);
    } finally {
      await setPortraitFeatures(tenantId, { discussion: true });
      signedIn = null;
    }
  });

  it('lists held comments and recent declines in the staff queue', async () => {
    const a = await import('./discussion-actions');
    const { countHeldComments, moderationQueue } = await import('./discussion');
    signedIn = people.neighbor;
    const posted = await a.postComment({ tenantSlug, dimensionId, body: 'First time here — what about the bus lanes?' });
    expect(posted).toMatchObject({ ok: true, data: { pendingApproval: true } });
    const id = (posted as { ok: true; data: { commentId: string } }).data.commentId;

    signedIn = people.moderator;
    expect(await countHeldComments(tenantId)).toBe(1);
    let queue = await moderationQueue(tenantId);
    expect(queue.heldTotal).toBe(1);
    expect(queue.held).toEqual([
      expect.objectContaining({ id, dimensionId, state: 'held', staff: false, isReply: false, body: 'First time here — what about the bus lanes?' }),
    ]);
    expect(queue.timeZone).toBe('America/New_York');

    expect(await a.moderateComment({ tenantSlug, commentId: id, action: 'decline', reason: 'duplicate' })).toMatchObject({ ok: true });
    expect(await countHeldComments(tenantId)).toBe(0);
    queue = await moderationQueue(tenantId);
    expect(queue.held).toEqual([]);
    // The comment removed and restored above is public again, so only the decline is listed.
    expect(queue.recentlyRemoved.map((c) => [c.id, c.state, c.reason])).toEqual([
      [id, 'declined', 'declined first post: duplicate'],
    ]);

    // A removal is listed with the moderator's reason, most recent first.
    expect(await a.moderateComment({ tenantSlug, commentId: heldId, action: 'remove', reason: 'personal attack' })).toMatchObject({ ok: true });
    queue = await moderationQueue(tenantId);
    expect(queue.recentlyRemoved.map((c) => [c.id, c.state, c.reason])).toEqual([
      [heldId, 'removed', 'personal attack'],
      [id, 'declined', 'declined first post: duplicate'],
    ]);
  });

  it('reads system-context state outside its transactions, so none waits for a second connection', async () => {
    // Each of these used to read in the system context from inside its
    // userDb transaction — moderation history for the thread and for a
    // reply's parent, memberships for the moderator check — waiting for a
    // second pooled connection while holding the first. As many requests at
    // once as the pool has connections then waited on each other for good;
    // on a one-connection pool, one request is enough (test/one-connection.ts).
    const m = await import('@deep-fryer/db');
    const a = await import('./discussion-actions');
    const [newcomer] = await m.getDb().insert(m.users).values({ email: `${uniq()}@newcomer.example.org` }).returning();
    cleanup.userIds.push(newcomer!.id);
    signedIn = newcomer!.id;
    const posted = await a.postComment({ tenantSlug, dimensionId, body: 'Cheap sneakers at my shop.' });
    const declinedId = (posted as { ok: true; data: { commentId: string } }).data.commentId;
    signedIn = people.moderator;
    expect(await a.moderateComment({ tenantSlug, commentId: declinedId, action: 'decline', reason: 'spam' })).toMatchObject({ ok: true });

    // The public thread, whose removed and declined comments need their history.
    signedIn = null;
    const thread = await onOneConnection(async () => (await import('./discussion')).dimensionThread(tenantId, dimensionId, null, 'new'));
    expect(thread.find((c) => c.id === heldId)).toMatchObject({ state: 'removed', body: null });
    expect(thread.some((c) => c.id === declinedId)).toBe(false);

    // A reply to the declined comment, whose state needs its history.
    signedIn = people.resident;
    const reply = await onOneConnection(async () =>
      (await import('./discussion-actions')).postComment({ tenantSlug, dimensionId, parentId: declinedId, body: 'Where?' }),
    );
    expect(reply).toEqual({ ok: false, error: 'You can reply once this comment is approved.' });

    // Moderating while signed out: refused after the membership check.
    signedIn = null;
    const moderated = await onOneConnection(async () =>
      (await import('./discussion-actions')).moderateComment({ tenantSlug, commentId: declinedId, action: 'approve' }),
    );
    expect(moderated).toEqual({ ok: false, error: 'This needs the moderator role on this portrait.' });
  });

  it('votes and moderates on their own transactions, reading the actor there without a second connection', async () => {
    // Both read the signed-in person inside their transaction (requireUserId,
    // and getAuth for dev mode). In a server action that was a fresh session
    // read on the pooled client every time, waiting for a second connection
    // while the transaction held the first; now the transaction answers with
    // the identity it was opened as (lib/auth.ts transactionAuth).
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    signedIn = people.moderator;
    const posted = await (await import('./discussion-actions')).postComment({ tenantSlug, dimensionId, body: 'Meeting notes are posted.' });
    const id = (posted as { ok: true; data: { commentId: string } }).data.commentId;

    signedIn = people.neighbor;
    const voted = await onOneConnection(async () =>
      (await import('./discussion-actions')).voteComment({ tenantSlug, commentId: id, vote: 1 }),
    );
    expect(voted).toEqual({ ok: true, data: undefined });
    const votes = await m
      .getDb()
      .select({ vote: m.commentVotes.vote })
      .from(m.commentVotes)
      .where(and(eq(m.commentVotes.commentId, id), eq(m.commentVotes.userId, people.neighbor)));
    expect(votes).toEqual([{ vote: 1 }]);

    // The moderator restores the resident's comment (removed above), then removes it again.
    signedIn = people.moderator;
    const moderate = (action: 'remove' | 'restore') =>
      onOneConnection(async () =>
        (await import('./discussion-actions')).moderateComment({ tenantSlug, commentId: heldId, action, reason: 'one connection' }),
      );
    expect(await moderate('restore')).toEqual({ ok: true, data: { state: 'visible' } });
    expect(await moderate('remove')).toEqual({ ok: true, data: { state: 'removed' } });
    expect((await actionLog(heldId)).slice(-2)).toEqual([
      ['restore', people.moderator, 'one connection'],
      ['remove', people.moderator, 'one connection'],
    ]);
    signedIn = null;
  });
});
