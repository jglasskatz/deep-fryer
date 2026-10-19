import 'server-only';
import { redirect } from 'next/navigation';
import type { Role } from '@deep-fryer/core';
import type { Tenant } from '@deep-fryer/db';
import { adminTenant } from './admin-data';
import { getAuth, getRole, roleAtLeast } from './auth';
import { hasDatabase } from './env';

export interface AdminPageContext {
  tenant: Tenant;
  role: Role;
  devMode: boolean;
}

/**
 * Admin pages: require a signed-in member with `min` role, then resolve the
 * tenant. Signed-out visitors go to sign-in first and come back to `path` —
 * the page they asked for, query included, so a staff email's link to a run
 * or a review lands there after signing in. Sign-in comes before the tenant
 * lookup because that lookup runs as the visitor: a portrait that has never
 * published is invisible to anyone signed out (migration 0015), which is
 * exactly when its staff follow the worker's emails, and looking it up first
 * sent them to the home page with no way back. Every slug, real or not, gets
 * the same sign-in redirect, so this says nothing about which portraits
 * exist. Signed-in visitors who cannot see the portrait land on the home
 * page; members below `min` on the public portrait.
 */
export async function requireAdminPage(
  tenantSlug: string,
  min: Role = 'viewer',
  path = `/${tenantSlug}/admin`,
): Promise<AdminPageContext> {
  if (!hasDatabase()) redirect(`/${tenantSlug}?admin=needs-database`);
  const auth = await getAuth();
  if (!auth.devMode && !auth.userId) redirect(`/login?next=${encodeURIComponent(path)}`);
  const tenant = await adminTenant(tenantSlug);
  if (!tenant) redirect('/');
  const role = await getRole(tenant.id);
  if (!roleAtLeast(role, min)) redirect(`/${tenantSlug}?admin=forbidden`);
  return { tenant, role: role as Role, devMode: auth.devMode };
}
