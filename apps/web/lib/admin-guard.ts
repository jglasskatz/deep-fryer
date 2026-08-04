import { redirect } from 'next/navigation';
import type { Role } from '@deep-fryer/core';
import type { Tenant } from '@deep-fryer/db';
import { adminTenant } from './admin-data';
import { getAuth, getRole, roleAtLeast } from './auth';
import { hasDatabase } from './data';

export interface AdminPageContext {
  tenant: Tenant;
  role: Role;
  devMode: boolean;
}

/** Admin pages: resolve tenant, require a signed-in member with `min` role. */
export async function requireAdminPage(
  tenantSlug: string,
  min: Role = 'viewer',
): Promise<AdminPageContext> {
  if (!hasDatabase()) redirect(`/${tenantSlug}?admin=needs-database`);
  const tenant = await adminTenant(tenantSlug);
  if (!tenant) redirect('/');
  const auth = await getAuth();
  if (!auth.devMode && !auth.userId) redirect(`/login?next=/${tenantSlug}/admin`);
  const role = await getRole(tenant.id);
  if (!roleAtLeast(role, min)) redirect(`/${tenantSlug}`);
  return { tenant, role: role as Role, devMode: auth.devMode };
}
