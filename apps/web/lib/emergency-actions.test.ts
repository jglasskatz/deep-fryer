import { afterAll, describe, expect, it, vi } from 'vitest';
import { setPortraitFeatures } from './test-features';

/**
 * Emergency curation actions in dev mode (no AUTH_SECRET: the local
 * developer acts as owner), against the dev database. Two things are
 * checked: the shared core schemas refuse bad input before anything is
 * written, and what staff write reaches the public page only once
 * published — through the page's own read and through an anonymous
 * row-level-security context, which is what a resident's request runs as.
 */

// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.AUTH_SECRET;
const uniq = () => `em-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const heat = {
  slug: 'extreme-heat',
  name: 'Extreme heat',
  kind: 'extreme_heat' as const,
  description: 'Heat waves are the deadliest weather in the city.',
  likelihood: 5,
  severity: 4,
  dimensions: [
    { dimension_slug: 'health', impact: 'high' as const },
    { dimension_slug: 'energy', impact: 'moderate' as const },
  ],
  nws_events: ['Heat Advisory', 'Excessive Heat Warning'],
};

describe.skipIf(!hasDb)('emergency actions (dev mode, Postgres)', () => {
  const created: { tenantId: string; organizationId: string }[] = [];
  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (!created.length) return;
    await db.delete(m.tenants).where(inArray(m.tenants.id, created.map((c) => c.tenantId)));
    await db.delete(m.organizations).where(inArray(m.organizations.id, created.map((c) => c.organizationId)));
  });

  async function portrait() {
    const m = await import('@deep-fryer/db');
    const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name: 'Storm City' });
    await setPortraitFeatures(tenant.id, { emergency: true });
    created.push({ tenantId: tenant.id, organizationId: tenant.organizationId });
    return tenant;
  }

  /** What an anonymous resident's request can read (the enforced app role, no user). */
  async function anonymousHazards(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return m.withAuthContext(m.getDb(), null, (tx) =>
      tx.select({ slug: m.hazards.slug }).from(m.hazards).where(eq(m.hazards.tenantId, tenantId)),
    );
  }

  it('refuses invalid hazards, plans, and resources with the reason', async () => {
    const a = await import('./emergency-actions');
    const tenant = await portrait();
    const tenantSlug = tenant.slug;

    const badSlug = await a.createHazard({ tenantSlug, hazard: { ...heat, slug: 'Extreme Heat!' } });
    expect(badSlug).toMatchObject({ ok: false, error: expect.stringMatching(/^slug: use lowercase letters/) });
    const tooLikely = await a.createHazard({ tenantSlug, hazard: { ...heat, likelihood: 6 } });
    expect(tooLikely).toMatchObject({ ok: false, error: 'likelihood: ratings run from 1 to 5' });
    const badDimension = await a.createHazard({
      tenantSlug,
      hazard: { ...heat, dimensions: [{ dimension_slug: 'vibes', impact: 'high' }] as never },
    });
    expect(badDimension.ok).toBe(false);

    const plan = { title: 'Hazard Mitigation Plan', agency: 'Emergency Management', url: 'http://example.gov/hmp' };
    expect(await a.createPlan({ tenantSlug, plan })).toMatchObject({ ok: false, error: 'url: must be a full https:// link' });
    expect(await a.createPlan({ tenantSlug, plan: { ...plan, url: 'javascript:alert(1)' } })).toMatchObject({ ok: false });
    expect(
      await a.createPlan({ tenantSlug, plan: { ...plan, url: 'https://example.gov/hmp', languages: ['not a language'] } }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/not a language code/) });
    expect(
      await a.createPlan({ tenantSlug, plan: { ...plan, url: 'https://example.gov/hmp', hazard_slugs: ['no-such-hazard'] } }),
    ).toMatchObject({ ok: false, error: 'Unknown hazard: no-such-hazard.' });

    const resource = { name: 'Cooling center', kind: 'cooling_center' as const };
    expect(await a.createResource({ tenantSlug, resource: { ...resource, url: 'http://example.gov' } })).toMatchObject({ ok: false });
    expect(await a.createResource({ tenantSlug, resource: { ...resource, phone: 'call us' } })).toMatchObject({ ok: false });

    expect(await a.saveEmergencyConfig({ tenantSlug, config: { nws_zones: ['Manhattan'] } })).toMatchObject({ ok: false });
    expect(await a.saveEmergencyConfig({ tenantSlug, config: { time_zone: 'Mars/Base' } })).toMatchObject({ ok: false });
    expect(await a.updateHazard({ tenantSlug, id: 'not-a-uuid', hazard: heat })).toMatchObject({ ok: false, error: 'unknown record' });

    // Nothing above was written.
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    expect(await db.select().from(m.hazards).where(eq(m.hazards.tenantId, tenant.id))).toEqual([]);
    expect(await db.select().from(m.emergencyPlans).where(eq(m.emergencyPlans.tenantId, tenant.id))).toEqual([]);
  });

  it('writes, audits, and shows a record publicly only once it is published', async () => {
    const a = await import('./emergency-actions');
    const { emergencyView } = await import('./emergency');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const tenant = await portrait();
    const tenantSlug = tenant.slug;

    const created = await a.createHazard({ tenantSlug, hazard: heat });
    expect(created.ok).toBe(true);
    const hazardId = (created as { ok: true; data: { id: string } }).data.id;
    expect(await a.createHazard({ tenantSlug, hazard: heat })).toMatchObject({
      ok: false,
      error: 'A hazard with the slug "extreme-heat" already exists on this portrait.',
    });

    // Draft: staff-only.
    expect((await emergencyView(tenantSlug))!.hazards).toEqual([]);
    expect(await anonymousHazards(tenant.id)).toEqual([]);

    expect(await a.setEmergencyPublished({ tenantSlug, entity: 'hazard', id: hazardId, published: true })).toMatchObject({ ok: true });
    expect(await anonymousHazards(tenant.id)).toEqual([{ slug: 'extreme-heat' }]);

    const plan = await a.createPlan({
      tenantSlug,
      plan: {
        title: 'Heat plan',
        agency: 'Emergency Management',
        url: 'https://example.gov/heat',
        adopted_year: 2024,
        languages: ['ES', 'zh-hant'],
        hazard_slugs: ['extreme-heat'],
        published: true,
      },
    });
    expect(plan.ok).toBe(true);
    const resource = await a.createResource({
      tenantSlug,
      resource: { name: 'Cooling center hotline', kind: 'hotline', phone: '311', hazard_slugs: ['extreme-heat'], published: false },
    });
    expect(resource.ok).toBe(true);

    const config = await a.saveEmergencyConfig({
      tenantSlug,
      config: { nws_zones: ['NYC061'], emergency_phone: '911', info_phone: '311', time_zone: 'america/new_york' },
    });
    expect(config).toMatchObject({ ok: true, data: { time_zone: 'America/New_York' } });

    // An official alert that matches the hazard's NWS events, as the worker stores it.
    const inAnHour = new Date(Date.now() + 3_600_000);
    await db.insert(m.emergencyAlerts).values({
      tenantId: tenant.id,
      source: 'nws',
      sourceId: `urn:${uniq()}`,
      event: 'Heat Advisory',
      severity: 'Moderate',
      urgency: 'Expected',
      certainty: 'Likely',
      headline: 'Heat Advisory until 8 PM',
      description: 'Heat index values up to 100.',
      areaDesc: 'New York (Manhattan)',
      senderName: 'NWS Upton NY',
      url: 'https://api.weather.gov/alerts/urn:test',
      effective: new Date(),
      expires: inAnHour,
    });
    await db
      .insert(m.emergencyAlertSyncs)
      .values({ tenantId: tenant.id, lastAttemptAt: new Date(), lastSuccessAt: new Date() });

    const view = (await emergencyView(tenantSlug))!;
    expect(view.config).toMatchObject({ nws_zones: ['NYC061'], time_zone: 'America/New_York', emergency_phone: '911' });
    expect(view.sync.stale).toBe(false);
    expect(view.alerts.map((x) => [x.event, x.hazardSlugs])).toEqual([['Heat Advisory', ['extreme-heat']]]);
    expect(view.hazards).toMatchObject([{ slug: 'extreme-heat', risk: 20, band: 'very_high', activeNow: true }]);
    expect(view.plans).toMatchObject([{ title: 'Heat plan', languages: ['es', 'zh-Hant'], hazardSlugs: ['extreme-heat'] }]);
    expect(view.resources).toEqual([]); // unpublished

    // Renaming a hazard keeps plans pointing at it; deleting it unlinks them.
    // The edit comes from a form opened before the hazard was published and
    // still says `published: false`: visibility is setEmergencyPublished's
    // alone, so the edit cannot quietly take it off the public page.
    const [planBefore] = await db.select().from(m.emergencyPlans).where(eq(m.emergencyPlans.tenantId, tenant.id));
    const staleForm = { ...heat, slug: 'heat', published: false } as Parameters<typeof a.updateHazard>[0]['hazard'];
    expect(await a.updateHazard({ tenantSlug, id: hazardId, hazard: staleForm })).toMatchObject({ ok: true });
    expect(await anonymousHazards(tenant.id)).toEqual([{ slug: 'heat' }]);
    const [renamed] = await db.select().from(m.emergencyPlans).where(eq(m.emergencyPlans.tenantId, tenant.id));
    expect(renamed!.hazardSlugs).toEqual(['heat']);
    // The plan changed under its open edit form: a new updatedAt remounts it.
    expect(renamed!.updatedAt.getTime()).toBeGreaterThan(planBefore!.updatedAt.getTime());
    expect(await a.deleteHazard({ tenantSlug, id: hazardId })).toMatchObject({ ok: true });
    const [unlinked] = await db.select().from(m.emergencyResources).where(eq(m.emergencyResources.tenantId, tenant.id));
    expect(unlinked!.hazardSlugs).toEqual([]);
    expect((await emergencyView(tenantSlug))!.hazards).toEqual([]);

    const log = await db
      .select({ entity: m.auditLog.entity, action: m.auditLog.action })
      .from(m.auditLog)
      .where(eq(m.auditLog.tenantId, tenant.id));
    // (Provisioning logs its own entry; only this feature's writes are checked.)
    expect(log.filter((l) => l.entity !== 'tenant').map((l) => `${l.entity}:${l.action}`).sort()).toEqual(
      [
        'emergency_plan:create',
        'emergency_resource:create',
        'hazard:create',
        'hazard:delete',
        'hazard:publish',
        'hazard:update',
        'tenant_config:config:emergency',
      ].sort(),
    );
  });

  it('hides alerts that have expired and says when the feed is stale', async () => {
    const a = await import('./emergency-actions');
    const { emergencyView } = await import('./emergency');
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const tenant = await portrait();
    await a.saveEmergencyConfig({ tenantSlug: tenant.slug, config: { nws_zones: ['NYC047'] } });
    await db.insert(m.emergencyAlerts).values({
      tenantId: tenant.id,
      source: 'nws',
      sourceId: `urn:${uniq()}`,
      event: 'Winter Storm Warning',
      severity: 'Severe',
      urgency: 'Expected',
      certainty: 'Likely',
      description: 'Heavy snow.',
      areaDesc: 'Kings (Brooklyn)',
      senderName: 'NWS Upton NY',
      url: 'https://api.weather.gov/alerts/urn:old',
      effective: new Date(Date.now() - 86_400_000),
      expires: new Date(Date.now() - 3_600_000),
    });
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await db.insert(m.emergencyAlertSyncs).values({ tenantId: tenant.id, lastAttemptAt: new Date(), lastSuccessAt: anHourAgo, lastError: 'fetch failed' });

    const view = (await emergencyView(tenant.slug))!;
    expect(view.alertsConfigured).toBe(true);
    expect(view.alerts).toEqual([]);
    expect(view.sync).toMatchObject({ stale: true, lastError: 'fetch failed' });
    expect(view.config.time_zone).toBe('America/New_York');
  });
});
