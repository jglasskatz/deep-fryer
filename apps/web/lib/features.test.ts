import { afterAll, describe, expect, it } from 'vitest';

/**
 * The web side of feature flags (SPEC-v7 §3.3): pages behind an off feature
 * are a 404, actions refuse, and the deployment's kill switch wins over a
 * portrait's setting. Against the dev database, like the other lib tests.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ff-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!hasDb)('feature flags (web)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    delete process.env.DF_DISABLED_FEATURES;
  });

  async function portrait(features?: Record<string, boolean>, organizationId?: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Flag City', organizationId });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      if (!organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    if (features) {
      await db
        .update(m.tenantConfig)
        .set({ value: features })
        .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
    }
    return tenant;
  }

  /** Next's notFound() throws an error whose digest marks a 404. */
  async function status(promise: Promise<unknown>): Promise<'ok' | 404 | string> {
    try {
      await promise;
      return 'ok';
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? '';
      return digest.includes('404') ? 404 : (err as Error).message;
    }
  }

  it('gives a new portrait the core product only: every feature page is a 404', async () => {
    const { portraitFeatures, requireFeature } = await import('./features');
    const tenant = await portrait();
    const resolved = await portraitFeatures(tenant.slug);
    expect(Object.values(resolved).some(Boolean)).toBe(false);
    for (const f of ['emergency', 'policy_analysis', 'involvement', 'discussion', 'family_compare'] as const) {
      expect(await status(requireFeature(tenant.slug, f))).toBe(404);
    }
  });

  it('shows a feature its owners turned on, and refuses actions for one that is off', async () => {
    const { requireFeature, assertFeatureForTenant } = await import('./features');
    const tenant = await portrait({ emergency: true, discussion: false });
    expect(await status(requireFeature(tenant.slug, 'emergency'))).toBe('ok');
    expect(await status(assertFeatureForTenant(tenant.id, 'emergency'))).toBe('ok');
    expect(await status(assertFeatureForTenant(tenant.id, 'discussion'))).toMatch(/turned off for this portrait/);
  });

  it('turns an organization’s compare and insights on when any of its portraits has them, and 404s them otherwise', async () => {
    // React's cache() only memoizes inside a server request, so each call below reads afresh.
    const { organizationFeatures, requireOrganizationFeature } = await import('./features');
    const { setPortraitFeatures } = await import('./test-features');
    const city = await portrait();
    const borough = await portrait({}, city.organizationId);
    expect((await organizationFeatures(city.organizationId)).family_compare).toBe(false);
    expect(await status(requireOrganizationFeature(city.organizationId, 'family_compare'))).toBe(404);

    const other = await portrait();
    await setPortraitFeatures(borough.id, { family_compare: true });
    await setPortraitFeatures(other.id, { family_compare: false });
    expect(await status(requireOrganizationFeature(other.organizationId, 'family_compare'))).toBe(404);
    // One borough on is enough: the family's compare serves every member.
    expect(await status(requireOrganizationFeature(city.organizationId, 'family_compare'))).toBe('ok');
  });

  it('lets the deployment switch a feature off over the portrait’s setting', async () => {
    const { requireFeature, resetDeploymentDisabledForTests, deploymentFeatureOn } = await import('./features');
    const tenant = await portrait({ emergency: true });
    process.env.DF_DISABLED_FEATURES = 'emergency,deep_fry';
    resetDeploymentDisabledForTests();
    try {
      expect(await status(requireFeature(tenant.slug, 'emergency'))).toBe(404);
      expect(deploymentFeatureOn('deep_fry')).toBe(false);
    } finally {
      delete process.env.DF_DISABLED_FEATURES;
      resetDeploymentDisabledForTests();
    }
    expect(deploymentFeatureOn('deep_fry')).toBe(true);
  });
});
