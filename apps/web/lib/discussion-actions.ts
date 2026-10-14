'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  comments,
  commentVotes,
  dimensions,
  moderationActions,
  tenantBySlug,
  tenantConfig,
} from '@deep-fryer/db';
import type { ReviewPolicyConfig } from '@deep-fryer/core';
import { requireTenantRole, requireUserId } from './auth';
import { action, UserError } from './action-result';
import { systemDb, userDb } from './db';

// The v1 anti-spam floor (SPEC.md §10).
const RATE_LIMIT_PER_MINUTE = 5;
const MAX_COMMENT_LENGTH = 10_000;

/**
 * Moderation actions taken by policy rather than a person (the first-post
 * hold) are attributed to this fixed system actor, never to the author
 * (SPEC-v3 §2.2): the audit trail must not say a resident removed their own
 * comment.
 */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export const postComment = action(async (input: {
  tenantSlug: string;
  dimensionId: string;
  parentId?: string;
  body: string;
}) => {
  const body = input.body.trim();
  if (!body) throw new UserError('Write something before posting.');
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new UserError(`Comments are limited to ${MAX_COMMENT_LENGTH.toLocaleString()} characters.`);
  }

  const tenant = await userDb((db) => tenantBySlug(db, input.tenantSlug));
  if (!tenant) throw new UserError('Unknown portrait.');
  const authorId = await requireUserId();
  // The moderation policy is behavior config, which the user role cannot
  // read (migration 0005) — read it in the system context.
  const policy = await systemDb()
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'review_policy')))
    .then((rows) => (rows[0]?.value ?? null) as ReviewPolicyConfig | null);

  // Everything the resident does runs as the user role: the database itself
  // refuses a comment attributed to anyone but the signed-in author.
  const comment = await userDb(async (db) => {
    // The dimension must belong to this tenant — a comment can never be
    // planted on another city's board through a crafted id (SPEC-v3 §2.2).
    const [dimension] = await db
      .select({ id: dimensions.id })
      .from(dimensions)
      .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
    if (!dimension) throw new UserError('Unknown dimension.');

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
      throw new UserError('You are posting too fast — wait a minute.');
    }

    if (input.parentId) {
      const [parent] = await db.select().from(comments).where(eq(comments.id, input.parentId));
      if (!parent || parent.tenantId !== tenant.id || parent.dimensionId !== dimension.id) {
        throw new UserError('Unknown parent comment.');
      }
      if (parent.parentId) throw new UserError('Replies nest one level deep.');
      const [lastLockAction] = await db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.commentId, input.parentId))
        .orderBy(desc(moderationActions.ts))
        .limit(1);
      if (lastLockAction?.action === 'lock') throw new UserError('This thread is locked.');
    }

    // …and the per-tenant "require approval for first post" toggle: the
    // first comment from a new account starts removed, pending a moderator.
    let pendingApproval = false;
    if (policy?.first_post_requires_approval) {
      const prior = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(comments)
        .where(and(eq(comments.tenantId, tenant.id), eq(comments.authorId, authorId)));
      pendingApproval = (prior[0]?.count ?? 0) === 0;
    }

    const [row] = await db
      .insert(comments)
      .values({
        tenantId: tenant.id,
        dimensionId: dimension.id,
        parentId: input.parentId ?? null,
        authorId,
        body,
        removedAt: pendingApproval ? new Date() : null,
        removedBy: pendingApproval ? SYSTEM_ACTOR_ID : null,
      })
      .returning();
    if (!row) throw new Error('comment insert failed');
    return { row, pendingApproval };
  });

  if (comment.pendingApproval) {
    // Logged by the system actor (a resident cannot write moderation records).
    await systemDb().insert(moderationActions).values({
      tenantId: tenant.id,
      commentId: comment.row.id,
      actorId: SYSTEM_ACTOR_ID,
      action: 'remove',
      reason: 'pending first-post approval',
    });
  }

  revalidatePath(`/${input.tenantSlug}/dim`);
  return { commentId: comment.row.id, pendingApproval: comment.pendingApproval };
});

export const voteComment = action(async (input: {
  tenantSlug: string;
  commentId: string;
  vote: 1 | -1 | 0;
}) => {
  if (![1, -1, 0].includes(input.vote)) throw new UserError('Invalid vote.');
  return userDb(async (db) => {
    const userId = await requireUserId();
    const tenant = await tenantBySlug(db, input.tenantSlug);
    if (!tenant) throw new UserError('Unknown portrait.');
    const [comment] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, input.commentId), eq(comments.tenantId, tenant.id)));
    if (!comment) throw new UserError('Unknown comment.');

    if (input.vote === 0) {
      await db
        .delete(commentVotes)
        .where(and(eq(commentVotes.commentId, comment.id), eq(commentVotes.userId, userId)));
    } else {
      await db
        .insert(commentVotes)
        .values({ commentId: comment.id, userId, vote: input.vote })
        .onConflictDoUpdate({
          target: [commentVotes.commentId, commentVotes.userId],
          set: { vote: input.vote },
        });
    }
    revalidatePath(`/${input.tenantSlug}/dim`);
  });
});

/** Moderator actions (SPEC.md §10): remove/restore/lock with logged reasons. */
export const moderateComment = action(async (input: {
  tenantSlug: string;
  commentId: string;
  action: 'remove' | 'restore' | 'lock';
  reason?: string;
}) => {
  return userDb(async (db) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'moderator');
    const actorId = await requireUserId();

    const [comment] = await db.select().from(comments).where(eq(comments.id, input.commentId));
    if (!comment || comment.tenantId !== tenant.id) throw new UserError('Unknown comment.');

    await db.transaction(async (tx) => {
      if (input.action === 'remove') {
        await tx
          .update(comments)
          .set({ removedAt: new Date(), removedBy: actorId })
          .where(eq(comments.id, input.commentId));
      } else if (input.action === 'restore') {
        await tx
          .update(comments)
          .set({ removedAt: null, removedBy: null })
          .where(eq(comments.id, input.commentId));
      }
      await tx.insert(moderationActions).values({
        tenantId: tenant.id,
        commentId: input.commentId,
        actorId,
        action: input.action,
        reason: input.reason?.slice(0, 500),
      });
    });

    revalidatePath(`/${input.tenantSlug}/dim`);
  });
});
