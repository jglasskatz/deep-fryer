import path from 'node:path';
import { tenantStorage as sharedTenantStorage, type TenantStorage } from '@deep-fryer/research';

export type { TenantStorage };

/** The worker's default local fallback is the web app's public/ directory. */
export function tenantStorage(tenantSlug: string): Promise<TenantStorage> {
  return sharedTenantStorage(tenantSlug, {
    localFallbackDir: path.resolve(process.cwd(), '..', 'web', 'public', 'evidence', tenantSlug),
  });
}
