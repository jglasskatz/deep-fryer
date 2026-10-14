'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accounts,
  getDb,
  organizationMembers,
  sessions,
  tenantMembers,
  users,
} from '@deep-fryer/db';
import { signOut } from '@/auth';
import { getAuth, requireUserId } from './auth';
import { action, UserError } from './action-result';

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
  await getDb()
    .update(users)
    .set({ displayName: parsed.displayName, name: parsed.name || null })
    .where(eq(users.id, userId));
  revalidatePath('/account');
});

/** Revoke every database session for this user — lost laptop, shared kiosk. */
export const signOutEverywhere = action(async () => {
  const userId = await requireUserId();
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
  await signOut({ redirectTo: '/login' });
});

/**
 * Delete my account. Public discussion is a civic record and replies hang
 * off comments, so comments stay — attributed to "Deleted account" — while
 * everything identifying goes: email, name, linked logins, sessions, and all
 * memberships. Refused while the person is the last owner of an
 * organization, which would otherwise be left with nobody able to
 * administer or pay for it.
 */
export const deleteAccount = action(async (input: { confirm: string }) => {
  const ctx = await getAuth();
  if (ctx.devMode) throw new UserError('Dev mode has no real account to delete.');
  const userId = await requireUserId();
  if (input.confirm.trim().toLowerCase() !== (ctx.email ?? '').toLowerCase()) {
    throw new UserError('Type your email address exactly to confirm.');
  }
  const db = getDb();

  const soleOwnerships = await db.execute<{ name: string }>(sql`
    SELECT o.name FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = ${userId} AND om.role = 'owner'
       AND NOT EXISTS (
         SELECT 1 FROM organization_members other
          WHERE other.organization_id = om.organization_id
            AND other.role = 'owner' AND other.user_id <> ${userId})`);
  if (soleOwnerships.length) {
    throw new UserError(
      `You are the only owner of ${soleOwnerships.map((r) => r.name).join(', ')}. Invite another owner first.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(tenantMembers).where(eq(tenantMembers.userId, userId));
    await tx.delete(organizationMembers).where(eq(organizationMembers.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx
      .update(users)
      .set({ email: null, name: null, image: null, emailVerified: null, displayName: 'Deleted account' })
      .where(eq(users.id, userId));
  });
  redirect('/');
});
