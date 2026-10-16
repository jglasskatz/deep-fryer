import { and, eq } from 'drizzle-orm';
import type { PortraitFeature } from '@deep-fryer/core';
import { getDb, tenantConfig } from '@deep-fryer/db';

/**
 * For tests only: set a portrait's stored feature flags (SPEC-v7 §3). A newly
 * provisioned portrait has every feature off, so a test that exercises a
 * feature turns it on first, the way an owner does in Settings. Writes in the
 * system context, like the provisioning it follows.
 */
export async function setPortraitFeatures(
  tenantId: string,
  features: Partial<Record<PortraitFeature, boolean>>,
): Promise<void> {
  await getDb()
    .insert(tenantConfig)
    .values({ tenantId, key: 'features', value: features })
    .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value: features } });
}
