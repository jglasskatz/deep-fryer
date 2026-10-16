import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import {
  ALL_PORTRAIT_FEATURES_ON,
  PORTRAIT_FEATURES,
  deploymentFeatureEnabled,
  parseDisabledFeatures,
  resolvePortraitFeatures,
  type DeploymentFeature,
  type Feature,
  type PortraitFeature,
  type Role,
} from '@deep-fryer/core';
import { tenantBySlug, tenantConfig, tenants, type DbExecutor } from '@deep-fryer/db';
import { UserError } from './action-result';
import { requireTenantRole } from './auth';
import { userDb } from './db';
import { hasDatabase } from './env';

/**
 * Feature flags in the web app (SPEC-v7 §3). Off means gone: a page behind an
 * off feature is a 404 (requireFeature), its links are not rendered (callers
 * branch on portraitFeatures), and its server actions refuse
 * (assertFeatureForTenant). Resolution is the core registry's, so the worker
 * and the pages always agree.
 */

/** The deployment's kill switch (DF_DISABLED_FEATURES), read once per process. */
let disabledCache: ReadonlySet<Feature> | null = null;
export function deploymentDisabled(): ReadonlySet<Feature> {
  if (!disabledCache) disabledCache = parseDisabledFeatures(process.env.DF_DISABLED_FEATURES).disabled;
  return disabledCache;
}

/** For tests: forget the parsed kill switch so a changed env is read again. */
export function resetDeploymentDisabledForTests(): void {
  disabledCache = null;
}

/** A deployment-wide feature (the deep fryer). */
export function deploymentFeatureOn(feature: DeploymentFeature): boolean {
  return deploymentFeatureEnabled(feature, deploymentDisabled());
}

async function storedFeatures(db: DbExecutor, tenantId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenantId), eq(tenantConfig.key, 'features')));
  return (row?.value as Record<string, unknown> | undefined) ?? null;
}

/**
 * Without a database (the demo build, which renders bundled sample data) every
 * feature is on, so the demo shows everything the product can do; the
 * deployment's kill switch still applies.
 */
const demoFeatures = () => resolvePortraitFeatures(ALL_PORTRAIT_FEATURES_ON, deploymentDisabled());

/**
 * A portrait's features, by slug, once per request. The `features` key is
 * publicly readable (migration 0011), so this works for signed-out readers.
 */
export const portraitFeatures = cache(async (tenantSlug: string): Promise<Record<PortraitFeature, boolean>> => {
  if (!hasDatabase()) return demoFeatures();
  const stored = await userDb(async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    return tenant ? storedFeatures(db, tenant.id) : null;
  });
  return resolvePortraitFeatures(stored, deploymentDisabled());
});

/**
 * The same, by tenant id (server actions, which resolve the tenant first).
 * It opens its own userDb transaction, so it is only for callers that do not
 * already hold one; inside userDb use portraitFeaturesIn.
 */
export async function portraitFeaturesById(tenantId: string): Promise<Record<PortraitFeature, boolean>> {
  if (!hasDatabase()) return demoFeatures();
  return userDb((db) => portraitFeaturesIn(db, tenantId));
}

/**
 * A portrait's features, read on a transaction the caller already holds.
 *
 * An action inside userDb must read its flags here (or through
 * assertFeatureForTenant with its executor), never through
 * portraitFeaturesById: that would open a second transaction on another
 * pooled connection while this one is still held. The pool is bounded
 * (DATABASE_POOL_MAX), so as many concurrent requests as it has connections
 * would each hold one and wait for another that never frees, and every
 * request in the process would hang with them. The `features` key is
 * publicly readable (migration 0011), so any role's transaction can read it.
 */
export async function portraitFeaturesIn(db: DbExecutor, tenantId: string): Promise<Record<PortraitFeature, boolean>> {
  if (!hasDatabase()) return demoFeatures();
  return resolvePortraitFeatures(await storedFeatures(db, tenantId), deploymentDisabled());
}

/**
 * An organization's features, for its own pages (/o/{org}/compare, /insights)
 * and the family nav: a feature is on when any of the organization's live
 * portraits has it on, because those pages serve all of them — the same rule
 * as translation (lib/translation-policy.ts). One query, once per request.
 */
export const organizationFeatures = cache(
  async (organizationId: string): Promise<Record<PortraitFeature, boolean>> => {
    if (!hasDatabase()) return demoFeatures();
    const rows = await userDb((db) =>
      db
        .select({ value: tenantConfig.value })
        .from(tenantConfig)
        .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
        .where(
          and(eq(tenants.organizationId, organizationId), isNull(tenants.archivedAt), eq(tenantConfig.key, 'features')),
        ),
    );
    const disabled = deploymentDisabled();
    const each = rows.map((r) => resolvePortraitFeatures(r.value as Record<string, unknown>, disabled));
    return Object.fromEntries(PORTRAIT_FEATURES.map((f) => [f, each.some((e) => e[f])])) as Record<
      PortraitFeature,
      boolean
    >;
  },
);

/** Page guard for an organization's page (404 when no portrait of it has the feature). */
export async function requireOrganizationFeature(organizationId: string, feature: PortraitFeature): Promise<void> {
  if (!(await organizationFeatures(organizationId))[feature]) notFound();
}

/** Page guard: a page behind an off feature does not exist (404), public or staff. */
export async function requireFeature(tenantSlug: string, feature: PortraitFeature): Promise<void> {
  if (!(await portraitFeatures(tenantSlug))[feature]) notFound();
}

/**
 * Action guard: a forged request to an off feature is refused, with a message
 * staff can act on. An action already inside a userDb transaction passes its
 * executor, so the check reads in the same transaction instead of taking a
 * second connection (the `features` key is publicly readable, so any role can).
 */
export async function assertFeatureForTenant(
  tenantId: string,
  feature: PortraitFeature,
  db?: DbExecutor,
): Promise<void> {
  const features = db ? await portraitFeaturesIn(db, tenantId) : await portraitFeaturesById(tenantId);
  if (!features[feature]) {
    throw new UserError('This feature is turned off for this portrait. An owner can turn it on in Settings.');
  }
}

/**
 * requireTenantRole plus the feature check, for actions behind a feature:
 * the role is checked first (an outsider learns nothing about which features
 * a portrait has), then the feature.
 */
export async function requireTenantRoleWithFeature(
  tenantSlug: string,
  min: Role,
  feature: PortraitFeature,
): Promise<Awaited<ReturnType<typeof requireTenantRole>>> {
  const ctx = await requireTenantRole(tenantSlug, min);
  await assertFeatureForTenant(ctx.tenant.id, feature);
  return ctx;
}
