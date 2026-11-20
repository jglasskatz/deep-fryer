import path from 'node:path';
import { localPrivateDir, tenantStorage as sharedTenantStorage, type TenantStorage } from '@deep-fryer/research';

export type { TenantStorage };

/**
 * The worker runs from apps/worker. Its default local fallback for evidence
 * is the web app's public/ directory; a group's private files default to the
 * repository's private directory, which the web app does not serve.
 */
export function tenantStorage(tenantSlug: string): Promise<TenantStorage> {
  return sharedTenantStorage(tenantSlug, {
    localFallbackDir: path.resolve(process.cwd(), '..', 'web', 'public', 'evidence', tenantSlug),
    localPrivateDir: localPrivateDir(path.resolve(process.cwd(), '..', '..'), tenantSlug),
  });
}
