import { z } from 'zod';
import { framework } from '@deep-fryer/contract';
import type { Verdict } from './preflight.js';

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

// ---- Shared field rules ---------------------------------------------------------
//
// Staff curate everything below through the admin page, and the NYC setup
// script proposes the same records; both validate with these schemas so a
// row the script writes is a row the admin form would have accepted.

/**
 * A link residents will follow from the public page: https only, no
 * credentials, an actual URL (not "https://" alone). Mirrors the database
 * CHECK (`url LIKE 'https://%'`) and goes further, because the CHECK cannot
 * parse a URL.
 */
export function isHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.');
}

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, 'must be a full https:// link');

/**
 * Phone numbers are shown as tap-to-call links, so they must dial: digits
 * plus the separators people write (spaces, dashes, dots, parentheses), a
 * leading +, and * or # for short codes. Three digits minimum covers 911,
 * 311, and 988.
 */
export const PHONE_RE = /^\+?[0-9().\-\s*#]{3,40}$/;
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((p) => PHONE_RE.test(p) && (p.match(/\d/g)?.length ?? 0) >= 3, 'use a phone number such as 311 or (212) 639-9675');

/** The tel: link for a validated phone number (separators dropped), or null if it cannot dial. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const dial = phone.trim().replace(/[^0-9+*#]/g, '');
  return /\d{3}/.test(dial.replace(/[^0-9]/g, '')) ? `tel:${dial}` : null;
}

/**
 * An IANA time zone the runtime knows ("America/New_York", "UTC"). The
 * shape check refuses the offsets Intl also accepts ("+05:00"): a fixed
 * offset is wrong half the year wherever daylight saving applies.
 */
export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_EMERGENCY_TIME_ZONE = 'America/New_York';

// ---- Configuration (tenant_config key "emergency", public) --------------------

/** NWS UGC codes: county (NYC061) or forecast zone (NYZ072). */
export const UGC_RE = /^[A-Z]{2}[CZ]\d{3}$/;

export const emergencyConfigSchema = z.object({
  nws_zones: z.array(z.string().regex(UGC_RE, 'use NWS UGC codes like NYC061 or NYZ072')).max(50).default([]),
  alerts_signup_url: httpsUrlSchema.nullable().default(null),
  alerts_signup_label: z.string().trim().max(80).nullable().default(null),
  emergency_phone: phoneSchema.nullable().default(null),
  info_phone: phoneSchema.nullable().default(null),
  /**
   * The zone alert times are shown in. Alerts carry UTC offsets, but a
   * resident reading "until 8:00 PM" needs the city's local clock, not the
   * server's or the browser's (a library computer may be set to UTC).
   * Stored canonical ("america/new_york" → "America/New_York").
   */
  time_zone: z
    .string()
    .trim()
    .refine(isTimeZone, 'use an IANA time zone such as America/New_York')
    .transform((tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone)
    .default(DEFAULT_EMERGENCY_TIME_ZONE),
});
export type EmergencyConfig = z.infer<typeof emergencyConfigSchema>;

// ---- Curated records (hazards, plans, resources) ---------------------------------

/** Hazard slugs appear in URLs (`?hazard=heat`) and in plan/resource links. */
export const HAZARD_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const hazardSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(HAZARD_SLUG_RE, 'use lowercase letters, digits, and single dashes (e.g. extreme-heat)');

const ratingSchema = z.number().int().min(1, 'ratings run from 1 to 5').max(5, 'ratings run from 1 to 5');
const displayOrderSchema = z.number().int().min(0).max(10_000).default(0);
const hazardSlugListSchema = z
  .array(hazardSlugSchema)
  .max(30)
  .default([])
  .transform((slugs) => [...new Set(slugs)]);

/** A hazard as staff enter it (the `hazards` row without ids and timestamps). */
export const hazardInputSchema = z.object({
  slug: hazardSlugSchema,
  name: z.string().trim().min(1, 'a name is required').max(120),
  kind: z.enum(HAZARD_KINDS),
  description: z.string().trim().max(2000).default(''),
  likelihood: ratingSchema,
  severity: ratingSchema,
  dimensions: z
    .array(hazardDimensionImpactSchema)
    .max(21)
    .default([])
    .refine((d) => new Set(d.map((x) => x.dimension_slug)).size === d.length, 'each dimension once'),
  /** NWS event names, matched case-insensitively against active alerts. */
  nws_events: z
    .array(z.string().trim().min(1).max(120))
    .max(30)
    .default([])
    .transform((events) => [...new Map(events.map((e) => [e.toLowerCase(), e])).values()]),
  display_order: displayOrderSchema,
  published: z.boolean().default(false),
});
export type HazardInput = z.infer<typeof hazardInputSchema>;

/**
 * BCP 47 language tags, canonicalized ("ZH-hant" → "zh-Hant") so the public
 * page can name each language in its own script. Intl.getCanonicalLocales
 * throws on anything that is not a well-formed tag.
 */
export function canonicalLanguageTag(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? null;
  } catch {
    return null;
  }
}

export const languageListSchema = z
  .array(z.string())
  .max(40)
  .default([])
  .transform((tags, ctx) => {
    const out: string[] = [];
    for (const tag of tags) {
      const canonical = canonicalLanguageTag(tag);
      if (!canonical) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${tag}" is not a language code (use BCP 47, e.g. es, zh-Hant)` });
        return z.NEVER;
      }
      if (!out.includes(canonical)) out.push(canonical);
    }
    return out;
  });

export const emergencyPlanInputSchema = z.object({
  title: z.string().trim().min(1, 'a title is required').max(200),
  agency: z.string().trim().min(1, 'the adopting agency is required').max(200),
  url: httpsUrlSchema,
  adopted_year: z.number().int().min(1900).max(2100).nullable().default(null),
  summary: z.string().trim().max(2000).default(''),
  /** Languages the plan document itself is published in. */
  languages: languageListSchema,
  hazard_slugs: hazardSlugListSchema,
  display_order: displayOrderSchema,
  published: z.boolean().default(false),
});
export type EmergencyPlanInput = z.infer<typeof emergencyPlanInputSchema>;

export const emergencyResourceInputSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(200),
  kind: z.enum(RESOURCE_KINDS),
  description: z.string().trim().max(2000).default(''),
  phone: phoneSchema.nullable().default(null),
  url: httpsUrlSchema.nullable().default(null),
  hazard_slugs: hazardSlugListSchema,
  display_order: displayOrderSchema,
  published: z.boolean().default(false),
});
export type EmergencyResourceInput = z.infer<typeof emergencyResourceInputSchema>;

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

// ---- Talking to api.weather.gov --------------------------------------------------

/**
 * The User-Agent every NWS request carries. The API asks callers to
 * identify their application with a way to reach them (a site or an email)
 * so a misbehaving client is contacted instead of blocked; the worker, the
 * preflight, and the setup script all send this one string.
 *
 * `contact` is SUPPORT_EMAIL, else the address inside EMAIL_FROM
 * ("deep-fryer <no-reply@city.gov>" → no-reply@city.gov).
 */
export function nwsUserAgent(env: { APP_URL?: string; SUPPORT_EMAIL?: string; EMAIL_FROM?: string }): string {
  const site = env.APP_URL?.trim().replace(/\/+$/, '') || null;
  const fromAddress = /<([^>]+)>/.exec(env.EMAIL_FROM ?? '')?.[1] ?? env.EMAIL_FROM;
  const email = env.SUPPORT_EMAIL?.trim() || fromAddress?.trim() || null;
  const parts = [site, email ? `contact ${email}` : null].filter(Boolean);
  return parts.length ? `deep-fryer/1.0 (${parts.join('; ')})` : 'deep-fryer/1.0';
}

/** Request headers for the alerts feed: identification plus the GeoJSON media type. */
export function nwsRequestHeaders(env: { APP_URL?: string; SUPPORT_EMAIL?: string; EMAIL_FROM?: string }): Record<string, string> {
  return { 'User-Agent': nwsUserAgent(env), Accept: 'application/geo+json' };
}

/**
 * Whether a feed body is the alerts FeatureCollection at all. The worker
 * must tell "no alerts right now" (an empty features list: clear the page)
 * from "the feed answered something else" (an error page, a maintenance
 * notice: keep what we have and report the failure).
 */
export function isAlertsFeed(body: unknown): body is { features: unknown[] } {
  return typeof body === 'object' && body !== null && Array.isArray((body as { features?: unknown }).features);
}

/** Preflight verdict for one portrait's feed (scripts/preflight.ts). */
export function nwsFeedVerdict(
  zones: readonly string[],
  status: number,
  body: unknown,
): Verdict {
  const where = zones.join(',');
  if (status !== 200) return { status: 'fail', detail: `api.weather.gov answered ${status} for ${where}` };
  if (!isAlertsFeed(body)) return { status: 'fail', detail: `api.weather.gov answered without a features list for ${where}` };
  const { alerts, rejected } = parseNwsAlerts(body);
  const note = rejected ? `, ${rejected} unparseable` : '';
  return { status: 'pass', detail: `${where}: ${alerts.length} active alert(s)${note}` };
}
