import { afterAll, describe, expect, it } from 'vitest';
import { emergencyConfigSchema } from '@deep-fryer/core';

/**
 * alerts_sync against Postgres with the NWS feed injected (no network here,
 * and a test must not depend on today's weather). The fixture is the shape
 * api.weather.gov/alerts/active returns: a GeoJSON FeatureCollection whose
 * features carry CAP properties.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const NOW = new Date('2026-07-15T12:00:00-04:00');

function feature(id: string, props: Record<string, unknown> = {}) {
  return {
    id: `https://api.weather.gov/alerts/${id}`,
    type: 'Feature',
    geometry: null,
    properties: {
      '@id': `https://api.weather.gov/alerts/${id}`,
      id,
      areaDesc: 'New York (Manhattan); Kings (Brooklyn)',
      sent: '2026-07-14T03:10:00-04:00',
      effective: '2026-07-14T03:10:00-04:00',
      onset: '2026-07-15T11:00:00-04:00',
      expires: '2026-07-15T20:00:00-04:00',
      ends: '2026-07-15T20:00:00-04:00',
      status: 'Actual',
      messageType: 'Alert',
      category: 'Met',
      severity: 'Moderate',
      certainty: 'Likely',
      urgency: 'Expected',
      event: 'Heat Advisory',
      sender: 'w-nws.webmaster@noaa.gov',
      senderName: 'NWS Upton NY',
      headline: 'Heat Advisory issued July 14 at 3:10AM EDT until July 15 at 8:00PM EDT by NWS Upton NY',
      description: '* WHAT...Heat index values up to 100 expected.',
      instruction: 'Drink plenty of fluids, stay in an air-conditioned room, stay out of the sun.',
      response: 'Execute',
      ...props,
    },
  };
}

const feed = (...features: unknown[]) => ({ type: 'FeatureCollection', title: 'Current watches, warnings, and advisories', features });

describe.skipIf(!hasDb)('alerts_sync (Postgres, injected NWS feed)', () => {
  // Throwaway portraits are removed afterwards: left behind with real NYC
  // zones configured, a dev worker's cron would start polling the NWS for them.
  const created: { tenantId: string; organizationId: string }[] = [];
  afterAll(async () => {
    if (!created.length) return;
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    await db.delete(m.tenants).where(inArray(m.tenants.id, created.map((c) => c.tenantId)));
    await db.delete(m.organizations).where(inArray(m.organizations.id, created.map((c) => c.organizationId)));
  });

  async function provision(name: string) {
    const m = await import('@deep-fryer/db');
    const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name });
    created.push({ tenantId: tenant.id, organizationId: tenant.organizationId });
    return tenant;
  }

  async function setup(zones: string[]) {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const tenant = await provision('Alert City');
    const config = emergencyConfigSchema.parse({ nws_zones: zones });
    await db.insert(m.tenantConfig).values({ tenantId: tenant.id, key: 'emergency', value: config });
    return { m, db, tenant, config };
  }

  async function stored(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const alerts = await db.select().from(m.emergencyAlerts).where(eq(m.emergencyAlerts.tenantId, tenantId));
    const [sync] = await db.select().from(m.emergencyAlertSyncs).where(eq(m.emergencyAlertSyncs.tenantId, tenantId));
    return { alerts: alerts.sort((a, b) => a.sourceId.localeCompare(b.sourceId)), sync };
  }

  it('stores current alerts, updates them in place, and removes the ones the feed dropped', async () => {
    const { syncTenantAlerts } = await import('./alerts-sync.js');
    const { db, tenant, config } = await setup(['NYC061', 'NYC047']);
    const seen: { url: string; headers: Record<string, string> }[] = [];
    let body: unknown = feed(
      feature('urn:a'),
      feature('urn:b', { event: 'Coastal Flood Warning', severity: 'Severe', headline: 'Coastal Flood Warning' }),
      // Already over: the active feed can lag an expiry by a few minutes.
      feature('urn:old', { expires: '2026-07-15T08:00:00-04:00', ends: '2026-07-15T08:00:00-04:00' }),
      // Never stored: tests and exercises are not alerts.
      feature('urn:test', { status: 'Test' }),
    );
    const fetchJson = async (url: string, headers: Record<string, string>) => {
      seen.push({ url, headers });
      return body;
    };

    const first = await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson, now: NOW });
    expect(first).toMatchObject({ ok: true, stored: 2, removed: 0 });
    expect(seen[0]!.url).toBe('https://api.weather.gov/alerts/active?zone=NYC061,NYC047');
    expect(seen[0]!.headers['User-Agent']).toMatch(/^deep-fryer\/1\.0/);
    expect(seen[0]!.headers.Accept).toBe('application/geo+json');
    let s = await stored(tenant.id);
    expect(s.alerts.map((a) => [a.sourceId, a.event, a.severity])).toEqual([
      ['urn:a', 'Heat Advisory', 'Moderate'],
      ['urn:b', 'Coastal Flood Warning', 'Severe'],
    ]);
    expect(s.alerts[0]!.expires!.toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(s.sync).toMatchObject({ lastError: null });
    expect(s.sync!.lastSuccessAt!.getTime()).toBe(NOW.getTime());

    // The NWS updates an alert under the same id: the row changes in place.
    const later = new Date(NOW.getTime() + 5 * 60_000);
    body = feed(feature('urn:a', { headline: 'Heat Advisory extended until July 16 at 8:00PM EDT', expires: '2026-07-16T20:00:00-04:00', ends: null }));
    const second = await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson, now: later });
    expect(second).toMatchObject({ ok: true, stored: 1, removed: 1 });
    s = await stored(tenant.id);
    expect(s.alerts.map((a) => a.sourceId)).toEqual(['urn:a']);
    expect(s.alerts[0]!.headline).toBe('Heat Advisory extended until July 16 at 8:00PM EDT');
    expect(s.alerts[0]!.ends).toBeNull();
    expect(s.sync!.lastSuccessAt!.getTime()).toBe(later.getTime());

    // All clear: an empty feature list empties the page.
    body = feed();
    expect(await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson, now: later })).toMatchObject({ ok: true, stored: 0, removed: 1 });
    expect((await stored(tenant.id)).alerts).toEqual([]);
  });

  it('keeps the last good alerts and records the error when the feed fails', async () => {
    const { syncTenantAlerts } = await import('./alerts-sync.js');
    const { db, tenant, config } = await setup(['NYC081']);
    await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson: async () => feed(feature('urn:q')), now: NOW });

    const later = new Date(NOW.getTime() + 10 * 60_000);
    const down = await syncTenantAlerts({
      db,
      tenantId: tenant.id,
      config,
      fetchJson: async () => {
        throw new Error('api.weather.gov answered 503\n<html>…</html>');
      },
      now: later,
    });
    expect(down).toEqual({ tenantId: tenant.id, ok: false, error: 'api.weather.gov answered 503' });
    let s = await stored(tenant.id);
    expect(s.alerts.map((a) => a.sourceId)).toEqual(['urn:q']);
    expect(s.sync!.lastError).toBe('api.weather.gov answered 503');
    expect(s.sync!.lastAttemptAt.getTime()).toBe(later.getTime());
    expect(s.sync!.lastSuccessAt!.getTime()).toBe(NOW.getTime());

    // A body that is not the FeatureCollection is a failure, not "no alerts".
    const odd = await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson: async () => ({ title: 'Maintenance' }), now: later });
    expect(odd).toMatchObject({ ok: false, error: 'api.weather.gov answered without a features list' });
    expect((await stored(tenant.id)).alerts).toHaveLength(1);

    // Recovery clears the error.
    await syncTenantAlerts({ db, tenantId: tenant.id, config, fetchJson: async () => feed(feature('urn:q')), now: later });
    s = await stored(tenant.id);
    expect(s.sync).toMatchObject({ lastError: null });
    expect(s.sync!.lastSuccessAt!.getTime()).toBe(later.getTime());
  });

  it('syncs every configured portrait even when one of them fails', async () => {
    const { loadAlertTargets, syncAlertTargets } = await import('./alerts-sync.js');
    const failing = await setup(['NYC005']);
    const working = await setup(['NYC085']);
    // A portrait without zones, and one whose stored config no longer
    // validates, are not targets.
    const { m, db } = failing;
    const noZones = await provision('No Zones');
    await db.insert(m.tenantConfig).values({ tenantId: noZones.id, key: 'emergency', value: { nws_zones: [] } });
    const broken = await provision('Broken');
    await db.insert(m.tenantConfig).values({ tenantId: broken.id, key: 'emergency', value: { nws_zones: ['Manhattan'] } });

    const logged: string[] = [];
    const all = await loadAlertTargets(db, (msg) => logged.push(msg));
    const ids = new Set([failing.tenant.id, working.tenant.id, noZones.id, broken.id]);
    const ours = all.filter((t) => ids.has(t.tenantId));
    expect(ours.map((t) => t.tenantId).sort()).toEqual([failing.tenant.id, working.tenant.id].sort());
    expect(logged.some((l) => l.includes(broken.slug))).toBe(true);

    // Failing first in the list, so a throw that escaped would skip the second.
    const ordered = [ours.find((t) => t.tenantId === failing.tenant.id)!, ours.find((t) => t.tenantId === working.tenant.id)!];
    const outcomes = await syncAlertTargets(ordered, {
      db,
      now: NOW,
      fetchJson: async (url) => {
        if (url.includes('NYC005')) throw new TypeError('fetch failed');
        return feed(feature('urn:si', { areaDesc: 'Richmond (Staten Island)' }));
      },
    });
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect((await stored(failing.tenant.id)).sync).toMatchObject({ lastError: 'fetch failed', lastSuccessAt: null });
    const w = await stored(working.tenant.id);
    expect(w.alerts.map((a) => a.areaDesc)).toEqual(['Richmond (Staten Island)']);
    expect(w.sync).toMatchObject({ lastError: null });
  });
});
