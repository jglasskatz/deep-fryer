import { describe, expect, it } from 'vitest';

/**
 * enableTenantFeatures against the dev database: what a provisioning script
 * turns on for a portrait it has just created, and what it leaves alone on
 * one that already existed (an owner's explicit choice).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('enableTenantFeatures', () => {
  async function setup() {
    const m = await import('./index.js');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Feature City' });
    const where = and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features'));
    return {
      m,
      db,
      tenant,
      stored: async () => (await db.select().from(m.tenantConfig).where(where))[0]?.value as Record<string, boolean> | undefined,
      store: (value: Record<string, boolean>) => db.update(m.tenantConfig).set({ value }).where(where),
      drop: async () => {
        await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
        await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
      },
    };
  }

  it('turns a feature on for a portrait just provisioned, over the all-off defaults, and nothing else', async () => {
    const { m, db, tenant, stored, drop } = await setup();
    try {
      expect((await stored())!.translation).toBe(false);
      await m.enableTenantFeatures(db, tenant.id, ['translation'], { overrideStored: true });
      const after = (await stored())!;
      expect(after.translation).toBe(true);
      expect(Object.entries(after).filter(([, on]) => on).map(([f]) => f)).toEqual(['translation']);
    } finally {
      await drop();
    }
  });

  it('keeps an existing portrait’s explicit choice, and fills in only what its row does not say', async () => {
    const { m, db, tenant, stored, store, drop } = await setup();
    try {
      await store({ translation: false, emergency: true });
      await m.enableTenantFeatures(db, tenant.id, ['translation'], { overrideStored: false });
      expect(await stored()).toEqual({ translation: false, emergency: true });

      await store({ emergency: true });
      await m.enableTenantFeatures(db, tenant.id, ['translation'], { overrideStored: false });
      expect(await stored()).toEqual({ translation: true, emergency: true });

      // No row at all (a portrait from before the key existed): the features asked for, on.
      const { and, eq } = await import('drizzle-orm');
      await db.delete(m.tenantConfig).where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
      await m.enableTenantFeatures(db, tenant.id, ['translation'], { overrideStored: false });
      expect(await stored()).toEqual({ translation: true });
    } finally {
      await drop();
    }
  });
});
