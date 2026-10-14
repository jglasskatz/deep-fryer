import 'server-only';
import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import type { Role } from '@deep-fryer/core';
import {
  getDb,
  organizationMembers,
  tenantBySlug,
  tenantMembers,
  tenants,
  users,
  type Tenant,
} from '@deep-fryer/db';
import { auth } from '@/auth';
import { authConfigured, hasDatabase, isProduction } from './env';
import { UserError } from './action-result';

// Auth plumbing reads memberships in the system context (getDb): deciding
// who someone is cannot depend on the policies that decision feeds.

export type OrgRole = 'owner' | 'billing';

export interface AuthContext {
  userId: string | null;
  email: string | null;
  name: string | null;
  displayName: string | null;
  isStaff: boolean;
  /** Local development without AUTH_SECRET: every request acts as owner. */
  devMode: boolean;
}

/** Local-dev identity when auth is not configured (a real users row, so FKs hold). */
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

let devUserReady: Promise<void> | null = null;

function ensureDevUser(): Promise<void> {
  devUserReady ??= getDb()
    .insert(users)
    .values({
      id: DEV_USER_ID,
      name: 'Local developer',
      displayName: 'local-dev',
      email: 'dev@localhost',
      isStaff: true,
    })
    .onConflictDoNothing()
    .then(() => undefined);
  return devUserReady;
}

/**
 * The request's identity, memoized per request. Dev mode exists only outside
 * production: a production process without AUTH_SECRET throws here (and
 * already failed at boot via instrumentation.ts) instead of granting
 * anonymous owner access (SPEC-v3 §2.3).
 */
export const getAuth = cache(async (): Promise<AuthContext> => {
  if (!authConfigured()) {
    if (isProduction()) {
      throw new Error('AUTH_SECRET is not set: refusing anonymous dev mode in production');
    }
    if (hasDatabase()) await ensureDevUser();
    return {
      userId: hasDatabase() ? DEV_USER_ID : null,
      email: 'dev@localhost',
      name: 'Local developer',
      displayName: 'local-dev',
      isStaff: true,
      devMode: true,
    };
  }
  const session = await auth();
  const user = session?.user;
  return {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    name: user?.name ?? null,
    displayName: user?.displayName ?? null,
    isStaff: user?.isStaff ?? false,
    devMode: false,
  };
});

const ROLE_RANK: Record<Role, number> = { viewer: 0, moderator: 1, editor: 2, owner: 3 };

/**
 * The caller's role on a portrait. An organization owner is owner of every
 * portrait the organization holds — the same rule as member_role() in SQL,
 * so the app layer and the database agree.
 */
export const getRole = cache(async (tenantId: string): Promise<Role | null> => {
  const ctx = await getAuth();
  if (ctx.devMode) return 'owner';
  if (!ctx.userId) return null;
  const db = getDb();
  const [orgOwner] = await db
    .select({ role: organizationMembers.role })
    .from(tenants)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, tenants.organizationId),
        eq(organizationMembers.userId, ctx.userId),
      ),
    )
    .where(eq(tenants.id, tenantId));
  if (orgOwner?.role === 'owner') return 'owner';
  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, ctx.userId)));
  return member?.role ?? null;
});

/** The caller's organization-level role (billing and portfolio administration). */
export const getOrgRole = cache(async (organizationId: string): Promise<OrgRole | null> => {
  const ctx = await getAuth();
  if (ctx.devMode) return 'owner';
  if (!ctx.userId) return null;
  const [row] = await getDb()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, ctx.userId),
      ),
    );
  return row?.role ?? null;
});

export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function requireRole(tenantId: string, min: Role): Promise<Role> {
  const role = await getRole(tenantId);
  if (!roleAtLeast(role, min)) {
    throw new UserError(`This needs the ${min} role on this portrait.`);
  }
  return role as Role;
}

/**
 * The standard server-action preamble: resolve the tenant and gate on role
 * in one place, so no action can forget the check or vary its shape.
 */
export async function requireTenantRole(
  tenantSlug: string,
  min: Role,
): Promise<{ tenant: Tenant; role: Role }> {
  const tenant = await tenantBySlug(getDb(), tenantSlug);
  if (!tenant) throw new UserError(`Unknown portrait '${tenantSlug}'.`);
  const role = await requireRole(tenant.id, min);
  return { tenant, role };
}

/** Billing actions: org owners and billing contacts. */
export async function requireOrgRole(
  organizationId: string,
  allowed: OrgRole[] = ['owner', 'billing'],
): Promise<OrgRole> {
  const role = await getOrgRole(organizationId);
  if (!role || !allowed.includes(role)) {
    throw new UserError('This needs an organization owner or billing role.');
  }
  return role;
}

/** The acting user id for writes that require an author (comments, votes). */
export async function requireUserId(): Promise<string> {
  const ctx = await getAuth();
  if (ctx.userId) return ctx.userId;
  throw new UserError('Sign in to continue.');
}

/**
 * Only same-site relative paths survive as post-login destinations — closes
 * the v2 open redirect (`/login?next=https://evil.example`).
 */
export function safeNextPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
