import 'server-only';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import {
  getDb,
  invitations,
  organizationMembers,
  tenantMembers,
  users,
} from '@deep-fryer/db';

export interface MemberRow {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  since: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
}

export async function tenantMembersList(tenantId: string): Promise<MemberRow[]> {
  const rows = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      displayName: users.displayName,
      email: users.email,
      role: tenantMembers.role,
      since: tenantMembers.invitedAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, tenantId))
    .orderBy(asc(tenantMembers.role), asc(users.email));
  return rows.map((r) => ({ ...r, name: r.name ?? r.displayName }));
}

export async function organizationMembersList(organizationId: string): Promise<MemberRow[]> {
  const rows = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      displayName: users.displayName,
      email: users.email,
      role: organizationMembers.role,
      since: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.role), asc(users.email));
  return rows.map((r) => ({ ...r, name: r.name ?? r.displayName }));
}

export async function pendingInvitations(
  scope: { tenantId: string } | { organizationId: string },
): Promise<PendingInvitation[]> {
  const where =
    'tenantId' in scope
      ? eq(invitations.tenantId, scope.tenantId)
      : eq(invitations.organizationId, scope.organizationId);
  return getDb()
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        where,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}
