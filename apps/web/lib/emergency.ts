import 'server-only';
import { cache } from 'react';
import { and, asc, eq } from 'drizzle-orm';
import {
  ALERTS_STALE_AFTER_MS,
  alertIsCurrent,
  emergencyConfigSchema,
  hazardsForAlert,
  riskBand,
  riskScore,
  type AlertSeverity,
  type EmergencyConfig,
  type HazardDimensionImpact,
  type HazardKind,
  type ResourceKind,
  type RiskBand,
} from '@deep-fryer/core';
import {
  emergencyAlerts,
  emergencyAlertSyncs,
  emergencyPlans,
  emergencyResources,
  hazards,
  publishedDoughnut,
  tenantBySlug,
  tenantConfig,
  type DbExecutor,
  type EmergencyAlert,
  type EmergencyPlan,
  type EmergencyResource,
  type Hazard,
  type Tenant,
} from '@deep-fryer/db';
import { userDb } from './db';
import { hasDatabase } from './env';
import type { PublishedDimension, PublishedPortrait } from './portrait';

/**
 * Emergency view reads (SPEC-v5 §3). Everything goes through userDb, so
 * row-level security decides visibility: an anonymous visitor sees the
 * emergency config, official alerts, sync state, and published hazards,
 * plans, and resources (migration 0008); members also see drafts, which is
 * why the public read filters on `published` itself — an editor previewing
 * the public page must see exactly what residents see.
 *
 * Nothing here is AI output: alerts are the NWS's words as issued, the rest
 * is staff-curated.
 */

const SEVERITY_ORDER: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

export interface AlertView {
  id: string;
  /** The NWS id; staff reach the machine record through it (nwsAlertRecordUrl). */
  sourceId: string;
  event: string;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  areaDesc: string;
  senderName: string;
  /** The readable NWS page for the alert's area (see nwsAlertPageUrl). */
  url: string;
  effective: Date;
  /** When the hazard ends if the NWS said so, else when the message expires. */
  until: Date | null;
  /** Slugs of published hazards whose NWS event names match this alert. */
  hazardSlugs: string[];
}

export interface SyncState {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  /** No successful sync within ALERTS_STALE_AFTER_MS (or never). */
  stale: boolean;
}

export interface HazardView {
  id: string;
  slug: string;
  name: string;
  kind: HazardKind;
  description: string;
  likelihood: number;
  severity: number;
  risk: number;
  band: RiskBand;
  dimensions: HazardDimensionImpact[];
  nwsEvents: string[];
  displayOrder: number;
  published: boolean;
  /** An official alert matching one of this hazard's NWS events is current. */
  activeNow: boolean;
  /**
   * When the last of those alerts ends; null when one of them has no end
   * (or none is current). A saved copy of the page hides the "active now"
   * badge on its own once this passes (AlertsLive).
   */
  activeUntil: Date | null;
  /** Changes on every write, publish toggle included: the admin forms remount on it. */
  updatedAt: Date;
}

export interface PlanView {
  id: string;
  title: string;
  agency: string;
  url: string;
  adoptedYear: number | null;
  summary: string;
  languages: string[];
  hazardSlugs: string[];
  displayOrder: number;
  published: boolean;
  /** Also bumped when a hazard it links to is renamed or deleted. */
  updatedAt: Date;
}

export interface ResourceView {
  id: string;
  name: string;
  kind: ResourceKind;
  description: string;
  phone: string | null;
  url: string | null;
  hazardSlugs: string[];
  displayOrder: number;
  published: boolean;
  /** Also bumped when a hazard it links to is renamed or deleted. */
  updatedAt: Date;
}

export interface EmergencyView {
  tenant: Pick<Tenant, 'id' | 'slug' | 'name'>;
  config: EmergencyConfig;
  /** NWS zones are configured, so alerts are expected. */
  alertsConfigured: boolean;
  alerts: AlertView[];
  sync: SyncState;
  /** Highest risk first. */
  hazards: HazardView[];
  plans: PlanView[];
  resources: ResourceView[];
  /** The published portrait's dimensions (current wedge sizes for the doughnut). */
  dimensions: PublishedDimension[];
  /**
   * When this view was read. A copy of the page served later (saved for
   * offline, or the service worker's fallback on a slow network) compares
   * it with the device clock to tell residents its alerts are old.
   */
  renderedAt: Date;
}

/** The stored config, or the defaults when there is none or it no longer validates. */
export function parseEmergencyConfig(value: unknown): { config: EmergencyConfig; invalid: string | null } {
  if (value === undefined || value === null) return { config: emergencyConfigSchema.parse({}), invalid: null };
  const parsed = emergencyConfigSchema.safeParse(value);
  if (parsed.success) return { config: parsed.data, invalid: null };
  const issue = parsed.error.issues[0];
  return {
    config: emergencyConfigSchema.parse({}),
    invalid: issue ? `${issue.path.join('.') || 'config'}: ${issue.message}` : 'invalid',
  };
}

export function syncState(row: { lastAttemptAt: Date; lastSuccessAt: Date | null; lastError: string | null } | undefined, now: Date): SyncState {
  const lastSuccessAt = row?.lastSuccessAt ?? null;
  return {
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt,
    lastError: row?.lastError ?? null,
    stale: !lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > ALERTS_STALE_AFTER_MS,
  };
}

/**
 * When each hazard's matching alerts end: the latest `until` among them, or
 * null when any of them has no end (it stays active until the feed drops it).
 */
function activeUntilBySlug(alerts: AlertView[]): Map<string, Date | null> {
  const out = new Map<string, Date | null>();
  for (const a of alerts) {
    for (const slug of a.hazardSlugs) {
      const prev = out.get(slug);
      if (prev === null) continue;
      out.set(slug, a.until === null ? null : prev && prev > a.until ? prev : a.until);
    }
  }
  return out;
}

function hazardView(h: Hazard, active: Map<string, Date | null>): HazardView {
  const risk = riskScore(h.likelihood, h.severity);
  return {
    id: h.id,
    slug: h.slug,
    name: h.name,
    kind: h.kind,
    description: h.description,
    likelihood: h.likelihood,
    severity: h.severity,
    risk,
    band: riskBand(risk),
    dimensions: h.dimensions,
    nwsEvents: h.nwsEvents,
    displayOrder: h.displayOrder,
    published: h.published,
    activeNow: active.has(h.slug),
    activeUntil: active.get(h.slug) ?? null,
    updatedAt: h.updatedAt,
  };
}

const planView = (p: EmergencyPlan): PlanView => ({
  id: p.id,
  title: p.title,
  agency: p.agency,
  url: p.url,
  adoptedYear: p.adoptedYear,
  summary: p.summary,
  languages: p.languages,
  hazardSlugs: p.hazardSlugs,
  displayOrder: p.displayOrder,
  published: p.published,
  updatedAt: p.updatedAt,
});

const resourceView = (r: EmergencyResource): ResourceView => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  description: r.description,
  phone: r.phone,
  url: r.url,
  hazardSlugs: r.hazardSlugs,
  displayOrder: r.displayOrder,
  published: r.published,
  updatedAt: r.updatedAt,
});

/** Highest risk first; staff order breaks ties, then the name. */
export function byRisk(a: HazardView, b: HazardView): number {
  return b.risk - a.risk || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name);
}

/** Current alerts, most severe first, then the newest; each linked to the hazards it matches. */
function alertViews(rows: EmergencyAlert[], hazardRows: { slug: string; nwsEvents: string[] }[], now: Date): AlertView[] {
  const matchable = hazardRows.map((h) => ({ slug: h.slug, nws_events: h.nwsEvents }));
  return rows
    .filter((a) => alertIsCurrent({ expires: a.expires?.toISOString() ?? null, ends: a.ends?.toISOString() ?? null }, now))
    .map((a) => {
      const severity = (SEVERITY_ORDER as string[]).includes(a.severity) ? (a.severity as AlertSeverity) : 'Unknown';
      return {
        id: a.id,
        sourceId: a.sourceId,
        event: a.event,
        severity,
        urgency: a.urgency,
        certainty: a.certainty,
        headline: a.headline,
        description: a.description,
        instruction: a.instruction,
        areaDesc: a.areaDesc,
        senderName: a.senderName,
        url: a.url,
        effective: a.effective,
        until: a.ends ?? a.expires,
        hazardSlugs: hazardsForAlert(a.event, matchable).map((h) => h.slug),
      };
    })
    .sort(
      (x, y) =>
        SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity) ||
        y.effective.getTime() - x.effective.getTime(),
    );
}

async function loadEmergency(db: DbExecutor, tenant: Tenant, publishedOnly: boolean, now: Date) {
  const onlyPublished = <T extends { published: boolean }>(rows: T[]) => (publishedOnly ? rows.filter((r) => r.published) : rows);
  // Sequential on purpose: these run inside one transaction (userDb), and a
  // transaction is one connection — parallel queries would only queue.
  const [configRow] = await db
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'emergency')));
  const hazardRows = onlyPublished(
    await db.select().from(hazards).where(eq(hazards.tenantId, tenant.id)).orderBy(asc(hazards.displayOrder), asc(hazards.name)),
  );
  const planRows = onlyPublished(
    await db
      .select()
      .from(emergencyPlans)
      .where(eq(emergencyPlans.tenantId, tenant.id))
      .orderBy(asc(emergencyPlans.displayOrder), asc(emergencyPlans.title)),
  );
  const resourceRows = onlyPublished(
    await db
      .select()
      .from(emergencyResources)
      .where(eq(emergencyResources.tenantId, tenant.id))
      .orderBy(asc(emergencyResources.displayOrder), asc(emergencyResources.name)),
  );
  const alertRows = await db.select().from(emergencyAlerts).where(eq(emergencyAlerts.tenantId, tenant.id));
  const [syncRow] = await db.select().from(emergencyAlertSyncs).where(eq(emergencyAlertSyncs.tenantId, tenant.id));

  const { config, invalid } = parseEmergencyConfig(configRow?.value);
  const alertsConfigured = config.nws_zones.length > 0;
  // Alerts only mean something for a portrait that asked for them: zones
  // removed since the last sync leave rows the page must not show.
  const alerts = alertsConfigured ? alertViews(alertRows, hazardRows, now) : [];
  const active = activeUntilBySlug(alerts);
  return {
    config,
    configInvalid: invalid,
    configSaved: Boolean(configRow),
    alertsConfigured,
    alerts,
    sync: syncState(syncRow, now),
    hazards: hazardRows.map((h) => hazardView(h, active)).sort(byRisk),
    plans: planRows.map(planView),
    resources: resourceRows.map(resourceView),
  };
}

/**
 * The public emergency page for one portrait, or null when the portrait
 * does not exist (or is archived). Works for anonymous visitors.
 */
export const emergencyView = cache(async (tenantSlug: string): Promise<EmergencyView | null> => {
  if (!hasDatabase()) return null;
  return userDb(async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant || tenant.archivedAt) return null;
    const renderedAt = new Date();
    const view = await loadEmergency(db, tenant, true, renderedAt);
    const portrait = await publishedDoughnut<PublishedPortrait>(db, tenant.slug);
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      config: view.config,
      alertsConfigured: view.alertsConfigured,
      alerts: view.alerts,
      sync: view.sync,
      hazards: view.hazards,
      plans: view.plans,
      resources: view.resources,
      dimensions: [...(portrait?.dimensions ?? [])].sort((a, b) => a.display_order - b.display_order),
      renderedAt,
    };
  });
});

export interface EmergencyAdminView {
  config: EmergencyConfig;
  /** Set when a stored config no longer validates (the form shows defaults). */
  configInvalid: string | null;
  /** True once a config row exists at all. */
  configSaved: boolean;
  alertsConfigured: boolean;
  alerts: AlertView[];
  sync: SyncState;
  hazards: HazardView[];
  plans: PlanView[];
  resources: ResourceView[];
}

/**
 * Staff curation reads (/{tenant}/admin/emergency): every row, published or
 * not. Member-read policies apply, so a caller who is not a member of the
 * portrait sees only the public subset — the admin guard keeps them out
 * before that matters.
 */
export async function emergencyAdminView(tenant: Tenant): Promise<EmergencyAdminView> {
  return userDb((db) => loadEmergency(db, tenant, false, new Date()));
}
