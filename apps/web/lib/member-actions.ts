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
 */
async function ownerCount(tenantId: string): Promise<number> {
  // System context: org owners may be invisible to a tenant owner's role.
  const rows = await systemDb().execute<{ n: number }>(sql`
    SELECT count(DISTINCT user_id)::int AS n FROM (
      SELECT user_id FROM tenant_members WHERE tenant_id = ${tenantId} AND role = 'owner'
      UNION
      SELECT om.user_id FROM organization_members om
        JOIN tenants t ON t.organization_id = om.organization_id
       WHERE t.id = ${tenantId} AND om.role = 'owner'
    ) owners`);
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
      const [current] = await db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      if (!current) throw new UserError('Unknown member.');
      if (current.role === 'owner' && role !== 'owner' && (await ownerCount(tenant.id)) <= 1) {
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
      const [current] = await db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, input.userId)));
      if (!current) throw new UserError('Unknown member.');
      if (current.role === 'owner' && (await ownerCount(tenant.id)) <= 1) {
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

/** Leaving a portrait yourself (any role) — same last-owner rule. */
export const leaveTenant = action(async (input: { tenantSlug: string }) => {
  const { tenant, role } = await requireTenantRole(input.tenantSlug, 'viewer');
  const userId = await requireUserId();
  if (role === 'owner' && (await ownerCount(tenant.id)) <= 1) {
    throw new UserError('You are the last owner. Make someone else an owner first.');
  }
  await userDb((db) =>
    db
      .delete(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId))),
  );
  revalidatePath('/account');
});

// ---- Organization roles (owners administer every portrait; billing contacts pay) ----

async function orgFromSlug(slug: string) {
  const org = await organizationBySlug(systemDb(), slug);
  if (!org) throw new UserError('Unknown organization.');
  return org;
}

async function orgOwnerCount(organizationId: string): Promise<number> {
  const [row] = await systemDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, 'owner'),
      ),
    );
  return row?.n ?? 0;
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
    if (current.role === 'owner' && (await orgOwnerCount(org.id)) <= 1) {
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
