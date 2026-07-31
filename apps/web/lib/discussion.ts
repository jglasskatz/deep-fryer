import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  comments,
  commentVotes,
  dimensions,
  getDb,
  moderationActions,
  tenants,
  type Comment,
} from '@deep-fryer/db';

export interface CommentView {
  id: string;
  parentId: string | null;
  authorId: string;
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

export async function dimensionForPublicSlug(tenantSlug: string, dimSlug: string) {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  if (!tenant) return null;
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, dimSlug)));
  if (!dimension) return null;
  return { tenant, dimension };
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
  const db = getDb();
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.tenantId, tenantId), eq(comments.dimensionId, dimensionId)))
    .orderBy(desc(comments.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((c) => c.id);
  const votes = await db
    .select({
      commentId: commentVotes.commentId,
      score: sql<number>`coalesce(sum(${commentVotes.vote}), 0)::int`,
    })
    .from(commentVotes)
    .where(inArray(commentVotes.commentId, ids))
    .groupBy(commentVotes.commentId);
  const scoreById = new Map(votes.map((v) => [v.commentId, v.score]));

  const myVotes = viewerId
    ? await db
        .select()
        .from(commentVotes)
        .where(and(inArray(commentVotes.commentId, ids), eq(commentVotes.userId, viewerId)))
    : [];
  const myVoteById = new Map(myVotes.map((v) => [v.commentId, v.vote]));

  // A thread is locked when its latest lock/restore moderation action is a lock.
  const modActions = await db
    .select()
    .from(moderationActions)
    .where(inArray(moderationActions.commentId, ids))
    .orderBy(desc(moderationActions.ts));
  const lockedById = new Map<string, boolean>();
  for (const action of modActions) {
    if (lockedById.has(action.commentId)) continue;
    if (action.action === 'lock') lockedById.set(action.commentId, true);
    if (action.action === 'restore') lockedById.set(action.commentId, false);
  }

  const toView = (c: Comment): CommentView => ({
    id: c.id,
    parentId: c.parentId,
    authorId: c.authorId,
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
  for (const t of top) t.replies.sort(byNew);
  // Replies were collected newest-first; present them oldest-first.
  for (const t of top) t.replies.reverse();

  return top;
}
