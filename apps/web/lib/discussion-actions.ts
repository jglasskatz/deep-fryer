'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  comments,
  commentVotes,
  getDb,
  moderationActions,
  tenantBySlug,
} from '@deep-fryer/db';
import { requireTenantRole, requireUserId } from './auth';
import { configValue } from './admin-data';

// The v1 anti-spam floor (SPEC.md §10).
const RATE_LIMIT_PER_MINUTE = 5;
const MAX_COMMENT_LENGTH = 10_000;

export async function postComment(input: {
  tenantSlug: string;
  dimensionId: string;
  parentId?: string;
  body: string;
}) {
  const body = input.body.trim();
  if (!body) throw new Error('empty comment');
  if (body.length > MAX_COMMENT_LENGTH) throw new Error('comment too long');

  const db = getDb();
  const tenant = await tenantBySlug(db, input.tenantSlug);
  if (!tenant) throw new Error('unknown tenant');
  const authorId = await requireUserId();

  // v1 anti-spam floor (SPEC.md §10): per-user rate limit…
  const recent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comments)
    .where(
      and(
        eq(comments.tenantId, tenant.id),
        eq(comments.authorId, authorId),
        gt(comments.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  if ((recent[0]?.count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    throw new Error('you are posting too fast — wait a minute');
  }

  if (input.parentId) {
    const [parent] = await db.select().from(comments).where(eq(comments.id, input.parentId));
    if (!parent || parent.tenantId !== tenant.id) throw new Error('unknown parent comment');
    if (parent.parentId) throw new Error('replies nest one level deep');
    const [lastLockAction] = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.commentId, input.parentId))
      .orderBy(sql`ts DESC`)
      .limit(1);
    if (lastLockAction?.action === 'lock') throw new Error('this thread is locked');
  }

  // …and the per-tenant "require approval for first post" toggle: the first
  // comment from a new account starts removed, with a logged pending action
  // for moderators to restore.
  const policy = await configValue(tenant.id, 'review_policy');
  let pendingApproval = false;
  if (policy?.first_post_requires_approval) {
    const prior = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(eq(comments.tenantId, tenant.id), eq(comments.authorId, authorId)));
    pendingApproval = (prior[0]?.count ?? 0) === 0;
  }

  const [comment] = await db
    .insert(comments)
    .values({
      tenantId: tenant.id,
      dimensionId: input.dimensionId,
      parentId: input.parentId ?? null,
      authorId,
      body,
      removedAt: pendingApproval ? new Date() : null,
    })
    .returning();
  if (!comment) throw new Error('comment insert failed');

  if (pendingApproval) {
    await db.insert(moderationActions).values({
      tenantId: tenant.id,
      commentId: comment.id,
      actorId: authorId,
      action: 'remove',
      reason: 'pending first-post approval',
    });
  }

  revalidatePath(`/${input.tenantSlug}/dim`);
  return { commentId: comment.id, pendingApproval };
}

export async function voteComment(input: {
  tenantSlug: string;
  commentId: string;
  vote: 1 | -1 | 0;
}) {
  const db = getDb();
  const userId = await requireUserId();

  if (input.vote === 0) {
    await db
      .delete(commentVotes)
      .where(and(eq(commentVotes.commentId, input.commentId), eq(commentVotes.userId, userId)));
  } else {
    await db
      .insert(commentVotes)
      .values({ commentId: input.commentId, userId, vote: input.vote })
      .onConflictDoUpdate({
        target: [commentVotes.commentId, commentVotes.userId],
        set: { vote: input.vote },
      });
  }
  revalidatePath(`/${input.tenantSlug}/dim`);
}

/** Moderator actions (SPEC.md §10): remove/restore/lock with logged reasons. */
export async function moderateComment(input: {
  tenantSlug: string;
  commentId: string;
  action: 'remove' | 'restore' | 'lock';
  reason?: string;
}) {
  const db = getDb();
  const { tenant } = await requireTenantRole(input.tenantSlug, 'moderator');
  const actorId = await requireUserId();

  const [comment] = await db.select().from(comments).where(eq(comments.id, input.commentId));
  if (!comment || comment.tenantId !== tenant.id) throw new Error('unknown comment');

  if (input.action === 'remove') {
    await db
      .update(comments)
      .set({ removedAt: new Date(), removedBy: actorId })
      .where(eq(comments.id, input.commentId));
  } else if (input.action === 'restore') {
    await db
      .update(comments)
      .set({ removedAt: null, removedBy: null })
      .where(eq(comments.id, input.commentId));
  }

  await db.insert(moderationActions).values({
    tenantId: tenant.id,
    commentId: input.commentId,
    actorId,
    action: input.action,
    reason: input.reason,
  });

  revalidatePath(`/${input.tenantSlug}/dim`);
}
