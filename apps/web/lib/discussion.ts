import 'server-only';
import { createHmac } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { DEFAULT_EMERGENCY_TIME_ZONE, emergencyConfigSchema } from '@deep-fryer/core';
import {
  comments,
  commentVotes,
  dimensions,
  moderationActions,
  tenantBySlug,
  tenantConfig,
  type Comment,
  type DbExecutor,
} from '@deep-fryer/db';
import { systemDb, userDb } from './db';

// ---------------------------------------------------------------------------
// Comment moderation states (SPEC-v6 §3.1)
// ---------------------------------------------------------------------------

/**
 * Moderation taken by policy rather than a person — the first-post hold — is
 * attributed to this fixed system actor, never to the author (SPEC-v3 §2.2):
 * the audit trail must not say a resident removed their own comment. It is
 * not a users row; it only ever appears in comments.removed_by and
 * moderation_actions.actor_id. This is the one definition: the actions
 * module, the thread, and the staff queue all import it from here.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The reasons logged with policy and approval actions. The moderation_action
 * enum only has remove / restore / lock, so approving is logged as a
 * 'restore' and declining as a 'remove'; these reasons are what tell a
 * person reading the log which is which. The hold reason is the text v5
 * already wrote, kept verbatim so old rows read the same.
 *
 * Nothing derives a comment's state from these strings (see commentState):
 * they are for humans, and a moderator's own note may be appended to them.
 */
export const MODERATION_REASONS = {
  hold: 'pending first-post approval',
  approve: 'approved first post',
  decline: 'declined first post',
} as const;

/** Longest reason stored with a moderation action. */
const MAX_REASON_LENGTH = 500;

/**
 * Where a comment stands, derived on read — there is no state column. The
 * row's removal columns and the comment's moderation history already record
 * everything, so the rule below needs no migration and reads every comment
 * written before it correctly.
 *
 * - `visible`  — public. `removed_at` is null.
 * - `held`     — a first comment awaiting approval: removed by the system
 *                actor (`removed_by = SYSTEM_ACTOR_ID`) and not yet reviewed.
 *                Never public; shown to its author and moderators only.
 * - `declined` — held, then a moderator declined it: `removed_by` is that
 *                moderator and the removal happened while the comment was
 *                held. Never public; shown to its author and moderators only.
 * - `removed`  — public, then a moderator removed it: `removed_by` is that
 *                moderator and the removal happened while it was visible.
 *                The public sees the "[removed by moderators]" placeholder;
 *                moderators see the text and can restore it.
 *
 * Only `declined` and `removed` look the same on the row (both removed by a
 * person), so only they need the history.
 */
export type CommentState = 'visible' | 'held' | 'declined' | 'removed';

/** One moderation_actions row as the state rule needs it, oldest first. */
export interface ModerationEvent {
  actorId: string;
  action: 'remove' | 'restore' | 'lock';
}

/**
 * The state rule. Held is read straight off the row. A comment a person
 * removed is either `declined` or `removed`, depending on whether it was
 * public at the moment of removal — learned by replaying its history as a
 * small state machine: a 'remove' by the system actor holds the comment; a
 * 'remove' by a person declines a held comment or removes a visible one;
 * any 'restore' (an approval or a restoration) makes it visible; 'lock'
 * concerns replies and changes nothing here.
 *
 * Replay depends only on actors and actions, never on reason text. When the
 * history does not account for the row (a removal made outside the app with
 * no log entry), a comment the replay never saw approved is `declined` —
 * it was never public — and anything else is `removed`, whose public
 * placeholder is the conservative answer for something that may have been
 * public.
 */
export function commentState(
  row: Pick<Comment, 'removedAt' | 'removedBy'>,
  history: readonly ModerationEvent[],
): CommentState {
  if (!row.removedAt) return 'visible';
  if (row.removedBy === SYSTEM_ACTOR_ID) return 'held';
  let replayed: CommentState = 'visible';
  for (const event of history) {
    if (event.action === 'lock') continue;
    if (event.action === 'restore') replayed = 'visible';
    else if (event.actorId === SYSTEM_ACTOR_ID) replayed = 'held';
    else if (replayed === 'held') replayed = 'declined';
    else if (replayed === 'visible') replayed = 'removed';
  }
  return replayed === 'held' || replayed === 'declined' ? 'declined' : 'removed';
}

/** What one viewer gets of a comment: its text, the removal placeholder, or nothing at all. */
export type CommentDisclosure = 'text' | 'placeholder' | 'omit';

/**
 * Visibility per SPEC-v6 §3.1. Held and declined comments were never public,
 * so everyone but their author and the moderators gets nothing — not even a
 * placeholder, which would announce something that was never published.
 * A removed comment was public, so the public keeps its placeholder (replies
 * under it still make sense); moderators read its text to decide whether to
 * restore it. The author of a removed comment sees the placeholder like
 * everyone else, as before.
 */
export function commentDisclosure(
  state: CommentState,
  viewer: { isAuthor: boolean; isModerator: boolean },
): CommentDisclosure {
  switch (state) {
    case 'visible':
      return 'text';
    case 'held':
    case 'declined':
      return viewer.isAuthor || viewer.isModerator ? 'text' : 'omit';
    case 'removed':
      return viewer.isModerator ? 'text' : 'placeholder';
  }
}

/** What a moderator can ask for. approve/decline are new in v6; remove/restore/lock are v1's. */
export const MODERATION_VERBS = ['approve', 'decline', 'remove', 'restore', 'lock'] as const;
export type ModerationVerb = (typeof MODERATION_VERBS)[number];

/**
 * How a moderation request changes a comment:
 * - `update` — what to write to the row's removal columns: `remove` sets
 *   removed_at = now and removed_by = the moderator, `clear` nulls both,
 *   null leaves the row alone (a lock only adds a log entry);
 * - `log` / `reason` — the moderation_actions row to write.
 */
export type ModerationPlan =
  | {
      ok: true;
      next: CommentState;
      update: 'remove' | 'clear' | null;
      log: ModerationEvent['action'];
      reason: string | null;
    }
  | { ok: false; error: string };

function withNote(base: string, note: string | undefined): string {
  const trimmed = note?.trim();
  return (trimmed ? `${base}: ${trimmed}` : base).slice(0, MAX_REASON_LENGTH);
}

function moderatorReason(note: string | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed.slice(0, MAX_REASON_LENGTH) : null;
}

/**
 * The allowed transitions, as one table so the server action, the thread,
 * and the tests agree:
 *
 *   approve  held | declined → visible   (logged 'restore', reason "approved first post")
 *   decline  held            → declined  (logged 'remove',  reason "declined first post")
 *   remove   visible         → removed   (logged 'remove',  the moderator's reason)
 *   restore  removed         → visible   (logged 'restore', the moderator's reason)
 *   lock     visible | removed, top-level comments only (logged 'lock'; the row is untouched)
 *
 * Everything else is refused with a message saying what to do instead: a
 * held comment is approved or declined, never "restored" (v5's only button,
 * which published comments nobody had read) or "removed" (which would put a
 * placeholder where nothing was ever public).
 */
export function planModeration(
  state: CommentState,
  verb: ModerationVerb,
  opts: { isReply: boolean; reason?: string },
): ModerationPlan {
  const refuse = (error: string): ModerationPlan => ({ ok: false, error });
  switch (verb) {
    case 'approve':
      if (state === 'held' || state === 'declined') {
        return { ok: true, next: 'visible', update: 'clear', log: 'restore', reason: withNote(MODERATION_REASONS.approve, opts.reason) };
      }
      return refuse(
        state === 'visible'
          ? 'This comment is already public.'
          : 'This comment was removed after it was published — restore it instead.',
      );
    case 'decline':
      if (state === 'held') {
        return { ok: true, next: 'declined', update: 'remove', log: 'remove', reason: withNote(MODERATION_REASONS.decline, opts.reason) };
      }
      return refuse(
        state === 'declined'
          ? 'This comment was already declined.'
          : state === 'removed'
            ? 'This comment is already removed.'
            : 'Only comments awaiting approval can be declined — remove it instead.',
      );
    case 'remove':
      if (state === 'visible') {
        return { ok: true, next: 'removed', update: 'remove', log: 'remove', reason: moderatorReason(opts.reason) };
      }
      return refuse(
        state === 'held'
          ? 'This comment is awaiting approval — approve or decline it.'
          : state === 'declined'
            ? 'This comment was declined and is not public.'
            : 'This comment is already removed.',
      );
    case 'restore':
      if (state === 'removed') {
        return { ok: true, next: 'visible', update: 'clear', log: 'restore', reason: moderatorReason(opts.reason) };
      }
      return refuse(
        state === 'held'
          ? 'This comment is awaiting approval — approve or decline it.'
          : state === 'declined'
            ? 'This comment was declined — approve it to publish it.'
            : 'This comment is not removed.',
      );
    case 'lock':
      if (opts.isReply) return refuse('Only a top-level comment’s thread can be locked.');
      if (state === 'held' || state === 'declined') return refuse('Approve this comment before locking its thread.');
      return { ok: true, next: state, update: null, log: 'lock', reason: moderatorReason(opts.reason) };
  }
}

/** A Postgres uuid[] literal for the definer functions, which take arrays. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * Each comment's moderation history, oldest first, with the reasons (staff
 * pages show the latest one). Callers choose the context through `db` —
 * see loadCommentStates for why the public thread reads it as the system.
 */
async function moderationHistory(
  db: DbExecutor,
  commentIds: readonly string[],
): Promise<Map<string, (ModerationEvent & { reason: string | null })[]>> {
  const history = new Map<string, (ModerationEvent & { reason: string | null })[]>();
  if (commentIds.length === 0) return history;
  const events = await db
    .select({
      commentId: moderationActions.commentId,
      actorId: moderationActions.actorId,
      action: moderationActions.action,
      reason: moderationActions.reason,
    })
    .from(moderationActions)
    .where(inArray(moderationActions.commentId, [...commentIds]))
    .orderBy(asc(moderationActions.ts));
  for (const { commentId, ...event } of events) {
    const list = history.get(commentId) ?? [];
    list.push(event);
    history.set(commentId, list);
  }
  return history;
}

/** Comments a person removed: the only rows whose state needs their history. */
function needsHistory(row: Pick<Comment, 'removedAt' | 'removedBy'>): boolean {
  return row.removedAt !== null && row.removedBy !== SYSTEM_ACTOR_ID;
}

/**
 * The state of each given comment (see CommentState).
 *
 * Moderators can read moderation_actions under their own role, so the
 * moderation action passes its own transaction. Residents and anonymous
 * visitors cannot (moderation_actions_member_read; only lock/restore rows
 * are public), yet the public thread must tell a declined comment (omit it)
 * from a removed one (show the placeholder) — so the public paths pass
 * systemDb(). Only the derived state leaves this function: no actor id or
 * reason reaches a non-member. This is the same kind of read postComment
 * makes of the review policy, and the history is read only for comments a
 * person removed.
 */
export async function loadCommentStates(
  db: DbExecutor,
  rows: readonly Pick<Comment, 'id' | 'removedAt' | 'removedBy'>[],
): Promise<Map<string, CommentState>> {
  const history = await moderationHistory(
    db,
    rows.filter(needsHistory).map((r) => r.id),
  );
  return new Map(rows.map((r) => [r.id, commentState(r, history.get(r.id) ?? [])]));
}

/** SQL for "held": the system actor's removal is still in place. */
function heldWhere(tenantId: string): SQL {
  return and(
    eq(comments.tenantId, tenantId),
    isNotNull(comments.removedAt),
    eq(comments.removedBy, SYSTEM_ACTOR_ID),
  )!;
}

// ---------------------------------------------------------------------------
// The public thread
// ---------------------------------------------------------------------------

/**
 * What the browser sees of a comment. The author's account id never leaves
 * the server (SPEC-v3 §2.3): the client gets a display name — or, for
 * accounts without one, a per-tenant pseudonym derived by HMAC so the same
 * resident is recognizable within one portrait's discussion but cannot be
 * correlated across portraits or mapped back to an account id.
 */
export interface CommentView {
  id: string;
  parentId: string | null;
  author: string;
  /** The author is on the portrait's team (SPEC-v6 §3.3): shown as a "Staff" label. */
  staff: boolean;
  mine: boolean;
  state: CommentState;
  /**
   * The comment's text, or null when this viewer gets only the "[removed by
   * moderators]" placeholder (a removed comment, for anyone but moderators).
   * Comments this viewer may not see at all are not in the thread.
   */
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  locked: boolean;
  score: number;
  myVote: number;
  replies: CommentView[];
}

export type CommentSort = 'top' | 'new';

export function pseudonym(tenantId: string, authorId: string): string {
  const secret = process.env.AUTH_SECRET ?? 'deep-fryer-dev';
  const digest = createHmac('sha256', secret).update(`${tenantId}:${authorId}`).digest('hex');
  return `resident-${digest.slice(0, 6)}`;
}

/** The public name of an author: their display name, else their pseudonym on this portrait. */
function authorName(names: ReadonlyMap<string, string | null>, tenantId: string, authorId: string): string {
  return names.get(authorId) ?? pseudonym(tenantId, authorId);
}

/**
 * Display names and the staff flag for a set of authors, both through
 * definer functions that return only those facts: the user role cannot read
 * other people's users rows (migration 0005) or the portrait's memberships.
 */
async function authorFacts(
  db: DbExecutor,
  tenantId: string,
  authorIds: readonly string[],
): Promise<{ names: Map<string, string | null>; staffIds: Set<string> }> {
  if (authorIds.length === 0) return { names: new Map(), staffIds: new Set() };
  const ids = uuidArray(authorIds);
  const [names, staff] = await Promise.all([
    db.execute<{ id: string; display_name: string | null }>(
      sql`select id, display_name from public_display_names(${ids}::uuid[])`,
    ),
    db.execute<{ id: string }>(sql`select id from public_staff_ids(${tenantId}::uuid, ${ids}::uuid[])`),
  ]);
  return {
    names: new Map(names.map((a) => [a.id, a.display_name?.trim() || null])),
    staffIds: new Set(staff.map((s) => s.id)),
  };
}

export async function dimensionForPublicSlug(tenantSlug: string, dimSlug: string) {
  return userDb(async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant) return null;
    const [dimension] = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, dimSlug)));
    if (!dimension) return null;
    return { tenant, dimension };
  });
}

/** Everything assembleThread needs, already loaded — so the visibility rules are testable without a database. */
export interface ThreadInput {
  tenantId: string;
  rows: readonly Pick<Comment, 'id' | 'parentId' | 'authorId' | 'body' | 'createdAt' | 'editedAt' | 'removedAt' | 'removedBy'>[];
  /** From loadCommentStates; a row missing here is judged from its own columns alone. */
  states: ReadonlyMap<string, CommentState>;
  viewerId: string | null;
  isModerator: boolean;
  names: ReadonlyMap<string, string | null>;
  staffIds: ReadonlySet<string>;
  scores: ReadonlyMap<string, number>;
  myVotes: ReadonlyMap<string, number>;
  locked: ReadonlyMap<string, boolean>;
  sort: CommentSort;
}

/**
 * Build the thread one viewer sees: apply commentDisclosure to every
 * comment, nest replies one level under their parent, and sort (top-level
 * by score or newest; replies oldest-first, as a conversation reads).
 *
 * Replies under a comment this viewer may not see are left out with it.
 * Promoting them to the top level would show a conversation whose start is
 * missing and hint at what was hidden; posting replies to held or declined
 * comments is refused anyway, so this only guards older rows.
 */
export function assembleThread(input: ThreadInput): CommentView[] {
  const { tenantId, viewerId, isModerator } = input;
  const omitted = new Set<string>();
  const viewById = new Map<string, CommentView>();
  for (const c of input.rows) {
    const state = input.states.get(c.id) ?? commentState(c, []);
    const isAuthor = viewerId !== null && c.authorId === viewerId;
    const disclosure = commentDisclosure(state, { isAuthor, isModerator });
    if (disclosure === 'omit') {
      omitted.add(c.id);
      continue;
    }
    viewById.set(c.id, {
      id: c.id,
      parentId: c.parentId,
      author: authorName(input.names, tenantId, c.authorId),
      staff: input.staffIds.has(c.authorId),
      mine: isAuthor,
      state,
      body: disclosure === 'text' ? c.body : null,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      locked: input.locked.get(c.id) ?? false,
      score: input.scores.get(c.id) ?? 0,
      myVote: input.myVotes.get(c.id) ?? 0,
      replies: [],
    });
  }

  const top: CommentView[] = [];
  for (const c of input.rows) {
    const view = viewById.get(c.id);
    if (!view) continue;
    if (c.parentId && omitted.has(c.parentId)) continue;
    const parent = c.parentId ? viewById.get(c.parentId) : undefined;
    if (parent) parent.replies.push(view);
    else top.push(view);
  }

  const byScore = (a: CommentView, b: CommentView) => b.score - a.score;
  const byNew = (a: CommentView, b: CommentView) => b.createdAt.getTime() - a.createdAt.getTime();
  top.sort(input.sort === 'top' ? byScore : byNew);
  for (const t of top) t.replies.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return top;
}

/**
 * Discussion thread for a dimension (SPEC.md §10): threaded, scored,
 * keyed on (tenant_id, dimension_id) so it is stable across versions and
 * years by construction. Visibility follows SPEC-v6 §3.1 (commentDisclosure):
 * held and declined comments reach only their author and moderators, and a
 * removed comment is a placeholder for everyone but moderators.
 */
export async function dimensionThread(
  tenantId: string,
  dimensionId: string,
  viewerId: string | null,
  sort: CommentSort = 'top',
  /** Moderators see held, declined, and removed comments' text (SPEC-v6 §3.1). */
  options: { isModerator?: boolean } = {},
): Promise<CommentView[]> {
  return userDb(async (db) => {
    const rows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.tenantId, tenantId), eq(comments.dimensionId, dimensionId)))
      .orderBy(desc(comments.createdAt));
    if (rows.length === 0) return [];

    const ids = rows.map((c) => c.id);
    const authorIds = [...new Set(rows.map((c) => c.authorId))];
    const [votes, myVotes, lockActions, authors, states] = await Promise.all([
      db
        .select({
          commentId: commentVotes.commentId,
          score: sql<number>`coalesce(sum(${commentVotes.vote}), 0)::int`,
        })
        .from(commentVotes)
        .where(inArray(commentVotes.commentId, ids))
        .groupBy(commentVotes.commentId),
      viewerId
        ? db
            .select()
            .from(commentVotes)
            .where(and(inArray(commentVotes.commentId, ids), eq(commentVotes.userId, viewerId)))
        : Promise.resolve([]),
      // A thread is locked when its latest lock/restore moderation action is
      // a lock. Those two actions are public (migration 0005), so this reads
      // under the viewer's own role.
      db
        .select({
          commentId: moderationActions.commentId,
          action: moderationActions.action,
        })
        .from(moderationActions)
        .where(inArray(moderationActions.commentId, ids))
        .orderBy(desc(moderationActions.ts)),
      authorFacts(db, tenantId, authorIds),
      loadCommentStates(systemDb(), rows),
    ]);
    const locked = new Map<string, boolean>();
    for (const action of lockActions) {
      if (locked.has(action.commentId)) continue;
      if (action.action === 'lock') locked.set(action.commentId, true);
      if (action.action === 'restore') locked.set(action.commentId, false);
    }

    return assembleThread({
      tenantId,
      rows,
      states,
      viewerId,
      isModerator: options.isModerator ?? false,
      names: authors.names,
      staffIds: authors.staffIds,
      scores: new Map(votes.map((v) => [v.commentId, v.score])),
      myVotes: new Map(myVotes.map((v) => [v.commentId, v.vote])),
      locked,
      sort,
    });
  });
}

// ---------------------------------------------------------------------------
// Staff: the moderation queue (SPEC-v6 §3.2)
// ---------------------------------------------------------------------------

/** Comments awaiting approval on a portrait — the admin overview's callout and the navigation count. */
export async function countHeldComments(tenantId: string): Promise<number> {
  return userDb(async (db) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(comments)
      .where(heldWhere(tenantId));
    return row?.n ?? 0;
  });
}

/** One comment as the staff queue shows it. Staff see the text whatever the state. */
export interface QueueComment {
  id: string;
  dimensionId: string;
  isReply: boolean;
  author: string;
  staff: boolean;
  state: CommentState;
  body: string;
  createdAt: Date;
  /** When it was held, declined, or removed. */
  removedAt: Date | null;
  /** The latest reason logged for its removal or decline, when a person gave one. */
  reason: string | null;
}

export interface ModerationQueue {
  /** Held comments, oldest first — the order they should be reviewed in. */
  held: QueueComment[];
  /** Total held (the list stops at HELD_QUEUE_LIMIT). */
  heldTotal: number;
  /** Comments a moderator removed or declined, most recent first. */
  recentlyRemoved: QueueComment[];
  /** The portrait's clock for staff timestamps (its emergency settings' zone, as other staff pages use). */
  timeZone: string;
}

/** How many held comments the queue lists at once; a spam wave should not make the page unusable. */
export const HELD_QUEUE_LIMIT = 100;
/** How many recent removals the queue lists. */
export const RECENTLY_REMOVED_LIMIT = 20;

/**
 * Everything /{tenant}/admin/discussion shows, read in one transaction as
 * the signed-in moderator (the page gates on the role first). Comments are
 * public rows; the history and its reasons are member-readable, so nothing
 * here needs the system context.
 */
export async function moderationQueue(tenantId: string): Promise<ModerationQueue> {
  return userDb(async (db) => {
    const [held, [heldCount], removed, [zoneRow]] = await Promise.all([
      db.select().from(comments).where(heldWhere(tenantId)).orderBy(asc(comments.createdAt)).limit(HELD_QUEUE_LIMIT),
      db.select({ n: sql<number>`count(*)::int` }).from(comments).where(heldWhere(tenantId)),
      db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.tenantId, tenantId),
            isNotNull(comments.removedAt),
            sql`${comments.removedBy} is distinct from ${SYSTEM_ACTOR_ID}::uuid`,
          ),
        )
        .orderBy(desc(comments.removedAt))
        .limit(RECENTLY_REMOVED_LIMIT),
      db
        .select({ value: tenantConfig.value })
        .from(tenantConfig)
        .where(and(eq(tenantConfig.tenantId, tenantId), eq(tenantConfig.key, 'emergency'))),
    ]);

    const authorIds = [...new Set([...held, ...removed].map((c) => c.authorId))];
    const [authors, history] = await Promise.all([
      authorFacts(db, tenantId, authorIds),
      moderationHistory(
        db,
        removed.map((c) => c.id),
      ),
    ]);

    const toQueue = (c: Comment, state: CommentState): QueueComment => {
      // The latest removal a person made, for its reason (the system hold has a fixed one).
      const lastRemoval = (history.get(c.id) ?? []).filter((e) => e.action === 'remove' && e.actorId !== SYSTEM_ACTOR_ID).at(-1);
      return {
        id: c.id,
        dimensionId: c.dimensionId,
        isReply: c.parentId !== null,
        author: authorName(authors.names, tenantId, c.authorId),
        staff: authors.staffIds.has(c.authorId),
        state,
        body: c.body,
        createdAt: c.createdAt,
        removedAt: c.removedAt,
        reason: lastRemoval?.reason ?? null,
      };
    };

    // A saved emergency config that no longer validates falls back to the default, as the emergency page does.
    const zone = zoneRow ? emergencyConfigSchema.safeParse(zoneRow.value) : null;
    return {
      held: held.map((c) => toQueue(c, 'held')),
      heldTotal: heldCount?.n ?? 0,
      recentlyRemoved: removed.map((c) => toQueue(c, commentState(c, history.get(c.id) ?? []))),
      timeZone: zone?.success ? zone.data.time_zone : DEFAULT_EMERGENCY_TIME_ZONE,
    };
  });
}
