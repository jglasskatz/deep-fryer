import { z } from 'zod';
import { framework } from '@deep-fryer/contract';

/**
 * Emergency view (SPEC-v5 §3): staff-curated hazards rated by likelihood and
 * severity, the plans and resources that address them, and official alerts
 * re-displayed from the National Weather Service. Everything here is pure —
 * the worker fetches, the web app renders, and both agree on these rules.
 */

export const HAZARD_KINDS = [
  'coastal_storm',
  'flooding',
  'extreme_heat',
  'winter_weather',
  'high_winds',
  'air_quality',
  'drought',
  'wildfire',
  'earthquake',
  'infectious_disease',
  'infrastructure_failure',
  'other',
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export const RESOURCE_KINDS = ['cooling_center', 'shelter', 'hotline', 'mutual_aid', 'food', 'medical', 'other'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type ImpactLevel = 'low' | 'moderate' | 'high';

/** A doughnut dimension a hazard threatens, and how much. */
export interface HazardDimensionImpact {
  dimension_slug: string;
  impact: ImpactLevel;
}

const FRAMEWORK_SLUGS = framework.dimensions.map((d) => d.slug) as [string, ...string[]];

export const hazardDimensionImpactSchema = z.object({
  dimension_slug: z.enum(FRAMEWORK_SLUGS),
  impact: z.enum(['low', 'moderate', 'high']),
});

// ---- Risk ---------------------------------------------------------------------

export type RiskBand = 'low' | 'moderate' | 'high' | 'very_high';

/** Classic 5×5 risk matrix: likelihood × severity, each 1–5. */
export function riskScore(likelihood: number, severity: number): number {
  if (![likelihood, severity].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) {
    throw new RangeError('likelihood and severity are integers from 1 to 5');
  }
  return likelihood * severity;
}

/** Bands [P]: 1–4 low, 5–9 moderate, 10–16 high, 20–25 very high. */
export function riskBand(score: number): RiskBand {
  if (score >= 20) return 'very_high';
  if (score >= 10) return 'high';
  if (score >= 5) return 'moderate';
  return 'low';
}

// ---- Configuration (tenant_config key "emergency", public) --------------------

/** NWS UGC codes: county (NYC061) or forecast zone (NYZ072). */
export const UGC_RE = /^[A-Z]{2}[CZ]\d{3}$/;

export const emergencyConfigSchema = z.object({
  nws_zones: z.array(z.string().regex(UGC_RE, 'use NWS UGC codes like NYC061 or NYZ072')).max(50).default([]),
  alerts_signup_url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'must be an https link')
    .nullable()
    .default(null),
  alerts_signup_label: z.string().trim().max(80).nullable().default(null),
  emergency_phone: z.string().trim().max(40).nullable().default(null),
  info_phone: z.string().trim().max(40).nullable().default(null),
});
export type EmergencyConfig = z.infer<typeof emergencyConfigSchema>;

// ---- NWS alerts ---------------------------------------------------------------

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
const SEVERITIES: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

/** One active alert, as stored and shown (text exactly as the NWS issued it). */
export interface NormalizedAlert {
  source: 'nws';
  source_id: string;
  event: string;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  area_desc: string;
  sender_name: string;
  effective: string;
  expires: string | null;
  ends: string | null;
  url: string;
}

const nwsFeatureSchema = z.object({
  id: z.string().url(),
  properties: z.object({
    id: z.string(),
    event: z.string(),
    severity: z.string().optional(),
    urgency: z.string().optional(),
    certainty: z.string().optional(),
    headline: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    instruction: z.string().nullable().optional(),
    areaDesc: z.string().optional(),
    senderName: z.string().optional(),
    effective: z.string().optional(),
    onset: z.string().nullable().optional(),
    expires: z.string().nullable().optional(),
    ends: z.string().nullable().optional(),
    status: z.string().optional(),
    messageType: z.string().optional(),
  }),
});

/**
 * Normalize an `api.weather.gov/alerts/active` GeoJSON response. Untrusted
 * input: features that do not parse are dropped and counted; only actual
 * ("status": "Actual") alerts are kept — never tests, exercises, or drafts.
 * Text fields are clipped so a malformed feed cannot bloat the database.
 */
export function parseNwsAlerts(body: unknown): { alerts: NormalizedAlert[]; rejected: number } {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { alerts: [], rejected: 0 };
  const alerts: NormalizedAlert[] = [];
  let rejected = 0;
  for (const raw of features) {
    const parsed = nwsFeatureSchema.safeParse(raw);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const p = parsed.data.properties;
    if ((p.status ?? 'Actual') !== 'Actual' || p.messageType === 'Cancel') continue;
    const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);
    alerts.push({
      source: 'nws',
      source_id: p.id.slice(0, 300),
      event: p.event.slice(0, 120),
      severity: (SEVERITIES as string[]).includes(p.severity ?? '') ? (p.severity as AlertSeverity) : 'Unknown',
      urgency: (p.urgency ?? 'Unknown').slice(0, 40),
      certainty: (p.certainty ?? 'Unknown').slice(0, 40),
      headline: clip(p.headline, 500),
      description: clip(p.description, 8000) ?? '',
      instruction: clip(p.instruction, 4000),
      area_desc: (p.areaDesc ?? '').slice(0, 1000),
      sender_name: (p.senderName ?? 'National Weather Service').slice(0, 200),
      effective: p.effective ?? p.onset ?? new Date(0).toISOString(),
      expires: p.expires ?? null,
      ends: p.ends ?? null,
      url: parsed.data.id.startsWith('https://api.weather.gov/') ? parsed.data.id : 'https://www.weather.gov/',
    });
  }
  alerts.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { alerts, rejected };
}

/** The NWS request for a portrait's zones (one request, comma-separated). */
export function nwsAlertsUrl(zones: readonly string[]): string {
  const valid = zones.filter((z) => UGC_RE.test(z));
  if (valid.length === 0) throw new Error('no valid NWS zones configured');
  return `https://api.weather.gov/alerts/active?zone=${valid.join(',')}`;
}

/**
 * Hazards an alert belongs to: a hazard lists the NWS event names it covers
 * ("Heat Advisory", "Excessive Heat Warning"); matching is case-insensitive
 * on the whole event name.
 */
export function hazardsForAlert<H extends { nws_events: string[] }>(event: string, hazards: H[]): H[] {
  const e = event.trim().toLowerCase();
  return hazards.filter((h) => h.nws_events.some((n) => n.trim().toLowerCase() === e));
}

/** An alert is current until it expires (or ends, if later); unknown expiry stays current. */
export function alertIsCurrent(alert: Pick<NormalizedAlert, 'expires' | 'ends'>, now: Date): boolean {
  const until = [alert.expires, alert.ends].filter((t): t is string => Boolean(t)).map((t) => Date.parse(t));
  if (until.length === 0) return true;
  return Math.max(...until) > now.getTime();
}

/** The feed is stale when the last successful sync is older than this. */
export const ALERTS_STALE_AFTER_MS = 30 * 60_000;
