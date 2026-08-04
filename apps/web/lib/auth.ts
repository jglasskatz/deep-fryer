import { and, eq } from 'drizzle-orm';
import type { Role } from '@deep-fryer/core';
import { getDb, tenantBySlug, tenantMembers, type Tenant } from '@deep-fryer/db';
import { supabaseConfigured, supabaseServer } from './supabase';

export interface AuthContext {
  userId: string | null;
  email: string | null;
  /** True when running without Supabase env: every request acts as owner. */
  devMode: boolean;
}

/**
 * Local development without a Supabase project runs the admin surface in dev
 * mode (acts as owner, clearly labeled in the UI). Any deployed environment
 * must set the Supabase env vars — §11 RLS assumes real auth.
 */
export async function getAuth(): Promise<AuthContext> {
  if (!supabaseConfigured()) {
    return { userId: null, email: null, devMode: true };
  }
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { userId: user?.id ?? null, email: user?.email ?? null, devMode: false };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, moderator: 1, editor: 2, owner: 3 };

export async function getRole(tenantId: string): Promise<Role | null> {
  const auth = await getAuth();
  if (auth.devMode) return 'owner';
  if (!auth.userId) return null;
  const db = getDb();
  const [member] = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, auth.userId)));
  return member?.role ?? null;
}

export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function requireRole(tenantId: string, min: Role): Promise<Role> {
  const role = await getRole(tenantId);
  if (!roleAtLeast(role, min)) {
    throw new Error(`requires ${min} role on this tenant`);
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
  if (!tenant) throw new Error(`unknown tenant '${tenantSlug}'`);
  const role = await requireRole(tenant.id, min);
  return { tenant, role };
}

/** Local-dev identity when Supabase auth is not configured. */
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

/** The acting user id for writes that require an author (comments, votes). */
export async function requireUserId(): Promise<string> {
  const auth = await getAuth();
  if (auth.userId) return auth.userId;
  if (auth.devMode) return DEV_USER_ID;
  throw new Error('sign in to continue');
}
