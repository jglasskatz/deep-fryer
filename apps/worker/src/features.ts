import { and, eq } from 'drizzle-orm';
import {
  parseDisabledFeatures,
  resolvePortraitFeatures,
  type Feature,
  type PortraitFeature,
} from '@deep-fryer/core';
import { tenantConfig, type DbExecutor } from '@deep-fryer/db';

/**
 * A portrait's features as the worker sees them (SPEC-v7 §3): the portrait's
 * stored `features` config, resolved against the registry defaults and the
 * deployment's kill switch (DF_DISABLED_FEATURES). The same resolver the web
 * app uses, so a feature the pages hide is also one the worker never runs.
 */
export async function portraitFeatures(
  db: DbExecutor,
  tenantId: string,
  disabled: ReadonlySet<Feature> = parseDisabledFeatures(process.env.DF_DISABLED_FEATURES).disabled,
): Promise<Record<PortraitFeature, boolean>> {
  const [row] = await db
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenantId), eq(tenantConfig.key, 'features')));
  return resolvePortraitFeatures(row?.value as Record<string, unknown> | undefined, disabled);
}
