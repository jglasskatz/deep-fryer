import type { Role } from '@deep-fryer/core';
import { requireAdminPage, type AdminPageContext } from './admin-guard';

/**
 * Who counts as a reviewer in the verification admin mode. One choke point
 * by design: introducing a dedicated least-privilege 'verifier' role later
 * is this line plus a role-enum migration, nothing else.
 */
export const VERIFY_ROLE: Role = 'editor';

export async function requireVerifyPage(tenantSlug: string): Promise<AdminPageContext> {
  return requireAdminPage(tenantSlug, VERIFY_ROLE);
}
