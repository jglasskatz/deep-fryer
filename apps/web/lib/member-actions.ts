'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Role } from '@deep-fryer/core';
import {
  invitations,
  organizationBySlug,
  organizationMembers,
  tenantMembers,
  type DbExecutor,
} from '@deep-fryer/db';
import { getAuth, requireOrgRole, requireTenantRole, requireUserId, type OrgRole } from './auth';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { acceptInvitation, createInvitation } from './invitations';
import { systemDb, userDb } from './db';

const tenantRole = z.enum(['owner', 'editor', 'moderator', 'viewer']);
const orgRole = z.enum(['owner', 'billing']);

/**
 * People with owner authority over a portrait: its tenant-level owners plus
 * the owners of the organization holding it. Removing or demoting the last
 * of them would leave the portrait unadministrable, so it is refused.
 *
 * Counted on the action's own transaction, with every counted owner row
 * locked until it ends (migration 0014 lock_tenant_owners). On the
 * transaction, because a systemDb() count here would wait for a second
 * pooled connection while the transaction holds the first, and as many
 * concurrent requests as the pool has connections would wait on each other
 * for good. Locked, because two owners demoting each other at the same
 * moment would otherwise each still count the other and leave no owner: now
 * the second waits for the first to commit, then counts without the owner
 * it demoted. A definer function, because organization owners may be
 * invisible to a tenant owner's own role.
 *
 * Callers lock before they read the member they act on, not only when that
 * member turns out to be an owner: a member read first could be promoted to
 * owner by a request committing in between, and the action would then
 * demote or remove an owner without counting. Taken first, the lock makes
 * every role change on the portrait (which all take it) wait its turn, so
 * the member read afterwards is current.
 */
async function lockedOwnerCount(db: DbExecutor, tenantId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`SELECT public.lock_tenant_owners(${tenantId}::uuid) AS n`);
  return Number(rows[0]?.n ?? 0);
}

export const inviteTenantMember = action(
  async (input: { tenantSlug: string; email: string; role: Role }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
    const role = tenantRole.parse(input.role);
    const ctx = await getAuth();
    const created = await createInvitation({
      scope: { kind: 'tenant', tenantId: tenant.id, role },
      email: input.email,
      invitedBy: ctx.userId,
      inviterName: ctx.name ?? ctx.displayName,
      targetName: tenant.name,
    });
    await audit(tenant.id, 'invitation', created.invitation.id, 'invite', null, {
      email: created.invitation.email,
      role,
    });
    revalidatePath(`/${tenant.slug}/admin/members`);
    return { url: created.url, emailed: created.emailed, email: created.invitation.email };
  },
);

export const revokeTenantInvitation = action(
  async (input: { tenantSlug: string; invitationId: string }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
    const [row] = await userDb((db) =>
      db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.tenantId, tenant.id)))
      .returning(),
    );
    if (!row) throw new UserError('Unknown invitation.');
    await audit(tenant.id, 'invitation', row.id, 'revoke', null, { email: row.email });
    revalidatePath(`/${tenant.slug}/admin/members`);
  },
);

export const changeTenantMemberRole = action(
  async (input: { tenantSlug: string; userId: string; role: Role }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
    const role = tenantRole.parse(input.role);
    return userDb(async (db) => {
      const owners = await lockedOwnerCount(db, tenant.id);
      const [current] = await db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      if (!current) throw new UserError('Unknown member.');
      if (current.role === 'owner' && role !== 'owner' && owners <= 1) {
        throw new UserError('This is the last owner. Make someone else an owner first.');
      }
      await db
        .update(tenantMembers)
        .set({ role })
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      await audit(tenant.id, 'tenant_member', input.userId, 'change_role', { role: current.role }, { role }, db);
      revalidatePath(`/${tenant.slug}/admin/members`);
    });
  },
);

export const removeTenantMember = action(
  async (input: { tenantSlug: string; userId: string }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
    return userDb(async (db) => {
      const owners = await lockedOwnerCount(db, tenant.id);
      const [current] = await db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      if (!current) throw new UserError('Unknown member.');
      if (current.role === 'owner' && owners <= 1) {
        throw new UserError('This is the last owner. Make someone else an owner first.');
      }
      // Database sessions mean the removal takes effect on their next request.
      await db
        .delete(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      await audit(tenant.id, 'tenant_member', input.userId, 'remove', { role: current.role }, null, db);
      revalidatePath(`/${tenant.slug}/admin/members`);
    });
  },
);

/**
 * Leaving a portrait yourself (any role) — same last-owner rule, counted in
 * the same transaction as the removal, so leaving cannot race an owner
 * demoting you (see lockedOwnerCount).
 */
export const leaveTenant = action(async (input: { tenantSlug: string }) => {
  const { tenant, role } = await requireTenantRole(input.tenantSlug, 'viewer');
  const userId = await requireUserId();
  await userDb(async (db) => {
    if (role === 'owner' && (await lockedOwnerCount(db, tenant.id)) <= 1) {
      throw new UserError('You are the last owner. Make someone else an owner first.');
    }
    await db
      .delete(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId)));
  });
  revalidatePath('/account');
});

// ---- Organization roles (owners administer every portrait; billing contacts pay) ----

async function orgFromSlug(slug: string) {
  const org = await organizationBySlug(systemDb(), slug);
  if (!org) throw new UserError('Unknown organization.');
  return org;
}

/**
 * An organization's owners, counted on the action's own transaction with
 * their rows locked until it ends — the organization-level twin of
 * lockedOwnerCount, for the same two reasons: no second pooled connection
 * while the transaction holds one, and two owners removing each other at
 * once are serialized instead of both going ahead. No definer function is
 * needed: the caller is an organization owner, whose own role reads and
 * locks every membership row of the organization
 * (organization_members_member_read and _owner_write, migration 0003).
 * Locked in user_id order, as lock_tenant_owners locks them, so the two never
 * take overlapping rows in opposite orders. Taken before the member is read,
 * for the reason lockedOwnerCount gives.
 */
async function lockedOrgOwnerCount(db: DbExecutor, organizationId: string): Promise<number> {
  const owners = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, 'owner'),
      ),
    )
    .orderBy(organizationMembers.userId)
    .for('update');
  return owners.length;
}

export const inviteOrgMember = action(
  async (input: { orgSlug: string; email: string; role: OrgRole }) => {
    const org = await orgFromSlug(input.orgSlug);
    await requireOrgRole(org.id, ['owner']);
    const role = orgRole.parse(input.role);
    const ctx = await getAuth();
    const created = await createInvitation({
      scope: { kind: 'organization', organizationId: org.id, role },
      email: input.email,
      invitedBy: ctx.userId,
      inviterName: ctx.name ?? ctx.displayName,
      targetName: org.name,
    });
    revalidatePath(`/o/${org.slug}`);
    return { url: created.url, emailed: created.emailed, email: created.invitation.email };
  },
);

export const revokeOrgInvitation = action(
  async (input: { orgSlug: string; invitationId: string }) => {
    const org = await orgFromSlug(input.orgSlug);
    await requireOrgRole(org.id, ['owner']);
    const [row] = await userDb((db) =>
      db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.organizationId, org.id)))
      .returning(),
    );
    if (!row) throw new UserError('Unknown invitation.');
    revalidatePath(`/o/${org.slug}`);
  },
);

export const removeOrgMember = action(async (input: { orgSlug: string; userId: string }) => {
  const org = await orgFromSlug(input.orgSlug);
  await requireOrgRole(org.id, ['owner']);
  return userDb(async (db) => {
    const owners = await lockedOrgOwnerCount(db, org.id);
    const [current] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, input.userId),
        ),
      );
    if (!current) throw new UserError('Unknown member.');
    if (current.role === 'owner' && owners <= 1) {
      throw new UserError('This is the last organization owner. Invite another owner first.');
    }
    await db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, input.userId),
        ),
      );
    revalidatePath(`/o/${org.slug}`);
  });
});

/** /invite/[token]: accept as the signed-in user. */
export const acceptInvitationAction = action(async (input: { token: string }) => {
  const ctx = await getAuth();
  if (!ctx.userId) throw new UserError('Sign in to accept this invitation.');
  const view = await acceptInvitation(input.token, { id: ctx.userId, email: ctx.email });
  return { href: view.targetHref, name: view.targetName };
});
