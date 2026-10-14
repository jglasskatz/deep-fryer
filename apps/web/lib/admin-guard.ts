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
 * Admin pages: resolve tenant, require a signed-in member with `min` role.
 * Signed-out visitors go to sign-in and come back to the page they asked
 * for; signed-in non-members land on the public portrait.
 */
export async function requireAdminPage(
  tenantSlug: string,
  min: Role = 'viewer',
  path = `/${tenantSlug}/admin`,
): Promise<AdminPageContext> {
  if (!hasDatabase()) redirect(`/${tenantSlug}?admin=needs-database`);
  const tenant = await adminTenant(tenantSlug);
  if (!tenant) redirect('/');
  const auth = await getAuth();
  if (!auth.devMode && !auth.userId) redirect(`/login?next=${encodeURIComponent(path)}`);
  const role = await getRole(tenant.id);
  if (!roleAtLeast(role, min)) redirect(`/${tenantSlug}?admin=forbidden`);
  return { tenant, role: role as Role, devMode: auth.devMode };
}
