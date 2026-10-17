'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accounts,
  organizationMembers,
  sessions,
  tenantMembers,
  users,
  verificationTokens,
} from '@deep-fryer/db';
import { signOut } from '@/auth';
import { getAuth, requireUserId } from './auth';
import { action, UserError } from './action-result';
import { systemDb, userDb } from './db';

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Display names need at least 2 characters.')
    .max(40, 'Display names are limited to 40 characters.')
    .regex(/^[\p{L}\p{N} ._'-]+$/u, 'Use letters, numbers, spaces, and . _ \' - only.'),
  name: z.string().trim().max(120).optional(),
});

/** The public handle shown on discussion boards (SPEC §14 B). */
export const updateProfile = action(async (input: { displayName: string; name?: string }) => {
  const userId = await requireUserId();
  const parsed = profileSchema.parse(input);
  // Row-level security: the users_self policy is what lets this row change.
  await userDb((db) =>
    db
      .update(users)
      .set({ displayName: parsed.displayName, name: parsed.name || null })
      .where(eq(users.id, userId)),
  );
  revalidatePath('/account');
});

/** Revoke every database session for this user — lost laptop, shared kiosk. */
export const signOutEverywhere = action(async () => {
  const userId = await requireUserId();
  await systemDb().delete(sessions).where(eq(sessions.userId, userId));
  await signOut({ redirectTo: '/login' });
});

/**
 * Delete my account. Public discussion is a civic record and replies hang
 * off comments, so comments stay — attributed to "Deleted account" — while
 * everything identifying goes: email, name, linked logins, sessions, and all
 * memberships. Refused while the person is the last owner of an
 * organization, which would otherwise be left with nobody able to
 * administer or pay for it.
 *
 * That refusal is decided inside the transaction that removes the
 * memberships, on locked owner rows, as every other path that unmakes an
 * owner decides it (lib/member-actions.ts, migration 0014). Checked before
 * the transaction, without a lock, two co-owners deleting their accounts at
 * the same moment — or one doing so while removeOrgMember removes the other
 * — would each still count the other, and both would go ahead.
 */
export const deleteAccount = action(async (input: { confirm: string }) => {
  const ctx = await getAuth();
  if (ctx.devMode) throw new UserError('Dev mode has no real account to delete.');
  const userId = await requireUserId();
  if (input.confirm.trim().toLowerCase() !== (ctx.email ?? '').toLowerCase()) {
    throw new UserError('Type your email address exactly to confirm.');
  }
  // System context: login accounts and sessions are not reachable by the user role.
  const db = systemDb();

  await db.transaction(async (tx) => {
    // Locks before any DELETE, in the order every owner-changing path takes
    // them, so this transaction queues behind one instead of deadlocking
    // with it: tenant-level owner rows, then organization owner rows (by
    // organization, then user_id, as lock_tenant_owners and
    // lockedOrgOwnerCount take them), and only then the person's other
    // membership rows. Deleting a non-owner portrait row first would hold it
    // while waiting for the person's organization owner row, which a member
    // action changing that portrait row holds already (lock_tenant_owners
    // locks the organization's owners before the action touches its target).
    await tx.execute(sql`
      SELECT 1 FROM tenant_members
       WHERE user_id = ${userId} AND role = 'owner'
       ORDER BY tenant_id
         FOR UPDATE`);
    // Every owner of each organization the person owns, locked: a
    // concurrent owner change waits for this transaction or this one waits
    // for it, and READ COMMITTED re-checks each row waited for, so an owner
    // who left in the meantime is not counted.
    const owners = await tx.execute<{ organization_id: string; user_id: string; name: string }>(sql`
      SELECT om.organization_id, om.user_id, o.name FROM organization_members om
        JOIN organizations o ON o.id = om.organization_id
       WHERE om.role = 'owner'
         AND om.organization_id IN (
           SELECT organization_id FROM organization_members
            WHERE user_id = ${userId} AND role = 'owner')
       ORDER BY om.organization_id, om.user_id
         FOR UPDATE OF om`);
    const others = new Map<string, { name: string; count: number }>();
    for (const row of owners) {
      const org = others.get(row.organization_id) ?? { name: row.name, count: 0 };
      if (row.user_id !== userId) org.count += 1;
      others.set(row.organization_id, org);
    }
    const soleOwnerships = [...others.values()].filter((org) => org.count === 0).map((org) => org.name);
    if (soleOwnerships.length) {
      throw new UserError(
        `You are the only owner of ${soleOwnerships.join(', ')}. Invite another owner first.`,
      );
    }

    await tx.delete(tenantMembers).where(eq(tenantMembers.userId, userId));
    await tx.delete(organizationMembers).where(eq(organizationMembers.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    // Sign-in links sent to the address and never used: Auth.js keys them by the address itself and deletes
    // one only when it is used, so they would keep the address the account no longer has (/privacy promises
    // it goes). Read from the row, in the case Auth.js stored it, rather than from the session.
    const [person] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (person?.email) {
      await tx.delete(verificationTokens).where(sql`lower(${verificationTokens.identifier}) = lower(${person.email})`);
    }
    await tx
      .update(users)
      .set({ email: null, name: null, image: null, emailVerified: null, displayName: 'Deleted account' })
      .where(eq(users.id, userId));
  });
  redirect('/');
});
