import 'server-only';
import { createHmac } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  comments,
  commentVotes,
  dimensions,
  moderationActions,
  tenantBySlug,
  type Comment,
} from '@deep-fryer/db';
import { userDb } from './db';

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
  mine: boolean;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  removed: boolean;
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

/**
 * Discussion thread for a dimension (SPEC.md §10): threaded, scored,
 * keyed on (tenant_id, dimension_id) so it is stable across versions and
 * years by construction. Removed comments render as tombstones.
 */
export async function dimensionThread(
  tenantId: string,
  dimensionId: string,
  viewerId: string | null,
  sort: CommentSort = 'top',
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
    const [votes, myVotes, modActions, authors] = await Promise.all([
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
      // A thread is locked when its latest lock/restore moderation action is a lock.
      db
        .select({
          commentId: moderationActions.commentId,
          action: moderationActions.action,
        })
        .from(moderationActions)
        .where(inArray(moderationActions.commentId, ids))
        .orderBy(desc(moderationActions.ts)),
      // Display names only, through the definer function: the user role
      // cannot read other people's rows in users (migration 0005).
      db.execute<{ id: string; display_name: string | null }>(
        sql`select id, display_name from public_display_names(${`{${authorIds.join(',')}}`}::uuid[])`,
      ),
    ]);
    const nameById = new Map(authors.map((a) => [a.id, a.display_name?.trim() || null]));
    const scoreById = new Map(votes.map((v) => [v.commentId, v.score]));
    const myVoteById = new Map(myVotes.map((v) => [v.commentId, v.vote]));
    const lockedById = new Map<string, boolean>();
    for (const action of modActions) {
      if (lockedById.has(action.commentId)) continue;
      if (action.action === 'lock') lockedById.set(action.commentId, true);
      if (action.action === 'restore') lockedById.set(action.commentId, false);
    }

    const toView = (c: Comment): CommentView => ({
      id: c.id,
      parentId: c.parentId,
      author: nameById.get(c.authorId) ?? pseudonym(tenantId, c.authorId),
      mine: viewerId !== null && c.authorId === viewerId,
      body: c.removedAt ? '' : c.body,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      removed: Boolean(c.removedAt),
      locked: lockedById.get(c.id) ?? false,
      score: scoreById.get(c.id) ?? 0,
      myVote: myVoteById.get(c.id) ?? 0,
      replies: [],
    });

    const viewById = new Map(rows.map((c) => [c.id, toView(c)]));
    const top: CommentView[] = [];
    for (const c of rows) {
      const view = viewById.get(c.id)!;
      if (c.parentId && viewById.has(c.parentId)) {
        viewById.get(c.parentId)!.replies.push(view);
      } else {
        top.push(view);
      }
    }

    const byScore = (a: CommentView, b: CommentView) => b.score - a.score;
    const byNew = (a: CommentView, b: CommentView) => b.createdAt.getTime() - a.createdAt.getTime();
    top.sort(sort === 'top' ? byScore : byNew);
    // Replies read oldest-first.
    for (const t of top) t.replies.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return top;
  });
}
