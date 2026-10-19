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
import { getAuth, getRole, requireTenantRole, requireUserId, roleAtLeast } from './auth';
import { action, UserError } from './action-result';
import { systemDb, userDb } from './db';
import { assertFeatureForTenant } from './features';
import {
  loadCommentStates,
  MODERATION_REASONS,
  MODERATION_VERBS,
  planModeration,
  SYSTEM_ACTOR_ID,
  type CommentState,
  type ModerationVerb,
} from './discussion';

// The v1 anti-spam floor (SPEC.md §10).
const RATE_LIMIT_PER_MINUTE = 5;
const MAX_COMMENT_LENGTH = 10_000;

/**
 * One comment's state (lib/discussion.ts CommentState), read in the system
 * context, or undefined when this portrait has no such comment. Only the
 * state leaves here. Callers run it outside any userDb transaction.
 */
async function commentStateInTenant(tenantId: string, commentId: string): Promise<CommentState | undefined> {
  const [row] = await systemDb()
    .select({ id: comments.id, removedAt: comments.removedAt, removedBy: comments.removedBy })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.tenantId, tenantId)));
  return row ? (await loadCommentStates(systemDb(), [row])).get(row.id) : undefined;
}

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
  // Discussion is a feature a portrait turns on (SPEC-v7 §3): with it off the
  // thread is not rendered, and a forged post is refused here.
  await assertFeatureForTenant(tenant.id, 'discussion');
  const authorId = await requireUserId();
  // The moderation policy is behavior config, which the user role cannot
  // read (migration 0005) — read it in the system context.
  const policy = await systemDb()
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'review_policy')))
    .then((rows) => (rows[0]?.value ?? null) as ReviewPolicyConfig | null);
  const role = await getRole(tenant.id);
  // A held or declined comment was never published: everyone but its author
  // and the moderators would see a reply with nothing above it (SPEC-v6
  // §3.1), so replies wait until it is approved. The state needs the parent's
  // moderation history, which only members can read — so it is derived in
  // the system context, and only the state is used. It is read here, before
  // the transaction below, not inside it: a systemDb read there would wait for
  // a second pooled connection while the transaction holds the first, and a
  // burst of replies would leave every connection waiting on another. It is
  // only acted on inside, after the parent has been checked under the
  // resident's own role, so it reveals nothing about another portrait's rows.
  const parentState = input.parentId ? await commentStateInTenant(tenant.id, input.parentId) : undefined;

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
      // Derived before the transaction (see parentState above).
      if (parentState === 'held' || parentState === 'declined') {
        throw new UserError('You can reply once this comment is approved.');
      }
      const [lastLockAction] = await db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.commentId, input.parentId))
        .orderBy(desc(moderationActions.ts))
        .limit(1);
      if (lastLockAction?.action === 'lock') throw new UserError('This thread is locked.');
    }

    // …and the per-tenant "require approval for first post" toggle: the
    // first comment from a new account is held — removed by the system
    // actor — until a moderator approves or declines it (SPEC-v6 §3.1).
    // People who can approve comments are not held: holding a moderator's
    // comment for a moderator is circular, and the database would refuse
    // to let them approve their own (comments_update_guard, migration 0006),
    // leaving a portrait with one moderator unable to post at all.
    let pendingApproval = false;
    if (policy?.first_post_requires_approval && !roleAtLeast(role, 'moderator')) {
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
      reason: MODERATION_REASONS.hold,
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
    await assertFeatureForTenant(tenant.id, 'discussion', db);
    const [comment] = await db
      .select({ id: comments.id, removedAt: comments.removedAt })
      .from(comments)
      .where(and(eq(comments.id, input.commentId), eq(comments.tenantId, tenant.id)));
    if (!comment) throw new UserError('Unknown comment.');
    // Scores belong to published comments. A held or declined comment was
    // never public, and a removed one is a placeholder — a vote on either
    // would be invisible, or (on a held comment) would count once a
    // moderator approves it. Taking a vote back is always allowed.
    if (comment.removedAt && input.vote !== 0) {
      throw new UserError('Only published comments can be voted on.');
    }

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

/**
 * Moderator actions (SPEC.md §10, SPEC-v6 §3.1): approve or decline a held
 * first comment; remove, restore, or lock a published one — each logged with
 * its reason. The allowed transitions live in planModeration (lib/
 * discussion.ts); anything else is refused with a message saying what to do
 * instead.
 *
 * Runs entirely as the moderator under row-level security: the role gate
 * here, and in the database is_moderator() on both the comments update and
 * the moderation_actions insert (whose actor must be the signed-in person).
 */
export const moderateComment = action(async (input: {
  tenantSlug: string;
  commentId: string;
  action: ModerationVerb;
  reason?: string;
}) => {
  // The role check reads memberships in the system context (lib/auth.ts), so
  // it runs before the transaction, not inside it: inside, it would wait for
  // a second pooled connection while the transaction holds the first, and a
  // burst of requests — anyone can send one, signed in or not — would leave
  // every connection waiting on another.
  const { tenant } = await requireTenantRole(input.tenantSlug, 'moderator');
  return userDb(async (db) => {
    await assertFeatureForTenant(tenant.id, 'discussion', db);
    const actorId = await requireUserId();
    if (!(MODERATION_VERBS as readonly string[]).includes(input.action)) {
      throw new UserError('Unknown moderation action.');
    }

    const [comment] = await db.select().from(comments).where(eq(comments.id, input.commentId));
    if (!comment || comment.tenantId !== tenant.id) throw new UserError('Unknown comment.');

    // Moderators may read the history under their own role, so the state
    // is derived inside this transaction.
    const state = (await loadCommentStates(db, [comment])).get(comment.id)!;
    const plan = planModeration(state, input.action, {
      isReply: comment.parentId !== null,
      reason: input.reason,
    });
    if (!plan.ok) throw new UserError(plan.error);

    // The database never lets an author change their own comment's removal
    // state (comments_update_guard, migration 0006) — say so plainly instead
    // of failing on the trigger. Dev mode runs as the owner role, which the
    // guard exempts, so the local developer can still moderate.
    if (plan.update && comment.authorId === actorId && !(await getAuth()).devMode) {
      throw new UserError('Another moderator needs to review your own comment.');
    }

    await db.transaction(async (tx) => {
      if (plan.update) {
        // Only if the row is still as it was read: two moderators acting on
        // the same comment at once must not both succeed (an approve racing
        // a decline would otherwise leave a log that disagrees with the row).
        const changed = await tx
          .update(comments)
          .set(
            plan.update === 'remove'
              ? { removedAt: new Date(), removedBy: actorId }
              : { removedAt: null, removedBy: null },
          )
          .where(
            and(
              eq(comments.id, comment.id),
              sql`${comments.removedBy} is not distinct from ${comment.removedBy}::uuid`,
            ),
          )
          .returning({ id: comments.id });
        if (changed.length === 0) {
          throw new UserError('Another moderator just changed this comment — reload to see where it stands.');
        }
      }
      await tx.insert(moderationActions).values({
        tenantId: tenant.id,
        commentId: comment.id,
        actorId,
        action: plan.log,
        reason: plan.reason,
      });
    });

    revalidatePath(`/${input.tenantSlug}/dim`);
    revalidatePath(`/${input.tenantSlug}/admin`);
    revalidatePath(`/${input.tenantSlug}/admin/discussion`);
    return { state: plan.next };
  });
});
