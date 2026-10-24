import 'server-only';
import { eq, and } from 'drizzle-orm';
import { ALL_PORTRAIT_FEATURES_ON, resolvePortraitFeatures } from '@deep-fryer/core';
import { organizations, tenantBySlug, tenantConfig, withAuthContext } from '@deep-fryer/db';
import { systemDb } from './db';
import { hasDatabase, appUrl } from './env';
import { deploymentDisabled } from './features';
import { evidenceUrl } from './data';

/** Extra public metadata read under anonymous RLS even for authenticated calls. */
export async function publicApiMetadata(slug: string) {
  const disabled = deploymentDisabled();
  if (!hasDatabase()) return { features: resolvePortraitFeatures(ALL_PORTRAIT_FEATURES_ON, disabled), organization: null };
  return withAuthContext(systemDb(), null, async (db) => {
    const tenant = await tenantBySlug(db, slug);
    if (!tenant) return null;
    const [config] = await db.select({ value: tenantConfig.value }).from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'features')));
    const [organization] = tenant.organizationId ? await db.select({ slug: organizations.slug, name: organizations.name })
      .from(organizations).where(eq(organizations.id, tenant.organizationId)) : [];
    return {
      features: resolvePortraitFeatures(config?.value as Record<string, unknown> | undefined, disabled),
      organization: organization ?? null,
    };
  });
}

/** Storage keys must stay within this portrait. Invalid legacy keys get no URL. */
export function absoluteEvidenceUrl(slug: string, path: string | undefined): string | null {
  if (!path || path.startsWith('/') || path.includes('\\')) return null;
  try {
    if (path.split('/').some((part) => !part || ['.', '..'].includes(decodeURIComponent(part)) || /[\\/?#]/.test(decodeURIComponent(part)))) return null;
    const url = new URL(evidenceUrl(slug, path), appUrl() + '/');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
