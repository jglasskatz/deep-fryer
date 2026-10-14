import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { effectiveLimits, standing, type Role } from '@deep-fryer/core';
import {
  getDb,
  invitations,
  organizationMembers,
  organizations,
  seatCount,
  subscriptionFor,
  tenantMembers,
  tenants,
  type DbExecutor,
  type Invitation,
} from '@deep-fryer/db';
import { UserError } from './action-result';
import { emailDeliverable, sendEmail, simpleHtml } from './email';
import { appUrl } from './env';
import type { OrgRole } from './auth';

/**
 * Invitations (SPEC-v4 §2). A token is shown once (in the email or the
 * copyable link) and only its sha256 is stored. Accepting requires being
 * signed in with the invited address, so a forwarded link grants nothing.
 * Invitations expire after a week and count against the plan's seats while
 * pending, so a lapsed or full organization cannot overcommit.
 */

export const INVITATION_DAYS = 7;

export type InvitationScope =
  | { kind: 'tenant'; tenantId: string; role: Role }
  | { kind: 'organization'; organizationId: string; role: OrgRole };

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new UserError('Enter a valid email address.');
  return email;
}

/** Pending, unexpired invitations for emails not yet holding any role in the organization. */
async function pendingSeatReservations(db: DbExecutor, organizationId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT i.email)::int AS n FROM invitations i
      LEFT JOIN tenants t ON t.id = i.tenant_id
     WHERE (i.organization_id = ${organizationId} OR t.organization_id = ${organizationId})
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       AND NOT EXISTS (
         SELECT 1 FROM users u WHERE lower(u.email) = i.email AND (
           EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id AND om.organization_id = ${organizationId})
           OR EXISTS (SELECT 1 FROM tenant_members tm JOIN tenants tt ON tt.id = tm.tenant_id
                       WHERE tm.user_id = u.id AND tt.organization_id = ${organizationId})))`);
  return Number(rows[0]?.n ?? 0);
}

async function organizationIdFor(scope: InvitationScope): Promise<string> {
  if (scope.kind === 'organization') return scope.organizationId;
  const [t] = await getDb()
    .select({ organizationId: tenants.organizationId })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId));
  if (!t) throw new UserError('Unknown portrait.');
  return t.organizationId;
}

export interface CreatedInvitation {
  invitation: Invitation;
  url: string;
  emailed: boolean;
}

export async function createInvitation(input: {
  scope: InvitationScope;
  email: string;
  invitedBy: string | null;
  inviterName: string | null;
  targetName: string;
}): Promise<CreatedInvitation> {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const organizationId = await organizationIdFor(input.scope);

  const sub = await subscriptionFor(db, organizationId);
  if (!standing(sub).active) {
    throw new UserError('Invitations are paused until the organization has an active plan (see Billing).');
  }
  const limit = effectiveLimits(sub!).seats;
  const [seats, pending] = await Promise.all([
    seatCount(db, organizationId),
    pendingSeatReservations(db, organizationId),
  ]);
  if (seats + pending >= limit) {
    throw new UserError(
      `All ${limit} seats on this plan are in use or reserved by pending invitations. Remove someone, revoke an invitation, or upgrade the plan.`,
    );
  }

  // One live invitation per (scope, email): re-inviting replaces the old link.
  const scopeFilter =
    input.scope.kind === 'tenant'
      ? eq(invitations.tenantId, input.scope.tenantId)
      : eq(invitations.organizationId, input.scope.organizationId);
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        scopeFilter,
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );

  const token = randomBytes(32).toString('base64url');
  const [invitation] = await db
    .insert(invitations)
    .values({
      tenantId: input.scope.kind === 'tenant' ? input.scope.tenantId : null,
      organizationId: input.scope.kind === 'organization' ? input.scope.organizationId : null,
      email,
      role: input.scope.role,
      tokenHash: hashToken(token),
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
    })
    .returning();
  const url = `${appUrl()}/invite/${token}`;

  let emailed = false;
  if (emailDeliverable()) {
    const who = input.inviterName ? `${input.inviterName} invited you` : 'You have been invited';
    const what = `${who} to ${input.targetName} on deep-fryer as ${articled(input.scope.role)}.`;
    try {
      await sendEmail({
        to: email,
        subject: `Invitation: ${input.targetName} on deep-fryer`,
        text: `${what}\n\nAccept within ${INVITATION_DAYS} days, signed in as ${email}:\n${url}\n`,
        html: simpleHtml(
          [what, `Accept within ${INVITATION_DAYS} days, signed in as ${email}.`],
          { href: url, label: 'Accept invitation' },
        ),
      });
      emailed = true;
    } catch (err) {
      console.error('[invitation email]', err);
    }
  }
  return { invitation: invitation!, url, emailed };
}

function articled(role: string): string {
  return /^[aeiou]/.test(role) ? `an ${role}` : `a ${role}`;
}

export interface InvitationView {
  invitation: Invitation;
  targetName: string;
  targetHref: string;
}

/** Resolve a raw token to a live invitation, or null (unknown, used, revoked, or expired). */
export async function liveInvitation(token: string): Promise<InvitationView | null> {
  const db = getDb();
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  if (!invitation) return null;
  if (invitation.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, invitation.tenantId));
    if (!t) return null;
    return { invitation, targetName: t.name, targetHref: `/${t.slug}/admin` };
  }
  const [o] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, invitation.organizationId!));
  if (!o) return null;
  return { invitation, targetName: o.name, targetHref: `/o/${o.slug}` };
}

/** Accept: email must match; membership upserted and the invitation consumed atomically. */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string | null },
): Promise<InvitationView> {
  const view = await liveInvitation(token);
  if (!view) throw new UserError('This invitation is no longer valid. Ask for a new one.');
  const { invitation } = view;
  if (!user.email || user.email.toLowerCase() !== invitation.email) {
    throw new UserError(
      `This invitation is for ${invitation.email}. Sign in with that address to accept it.`,
    );
  }
  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)))
      .returning();
    if (!claimed) throw new UserError('This invitation was already used.');
    if (invitation.tenantId) {
      await tx
        .insert(tenantMembers)
        .values({
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role as Role,
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tenantMembers.tenantId, tenantMembers.userId],
          set: { role: invitation.role as Role, joinedAt: new Date() },
        });
    } else {
      await tx
        .insert(organizationMembers)
        .values({
          organizationId: invitation.organizationId!,
          userId: user.id,
          role: invitation.role as OrgRole,
        })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role: invitation.role as OrgRole },
        });
    }
  });
  return view;
}
