import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emergencyConfigSchema } from '@deep-fryer/core';
import { alertsNotice, hasEnded } from '@/components/emergency/AlertsLive';
import {
  AlertsSection,
  GetAlertsSection,
  HelpSection,
  PlansSection,
  ThreatsSection,
  formatAlertTime,
  listParts,
  planLanguageNames,
} from '@/components/emergency/EmergencySections';
import { en } from './i18n/messages/en';
import { parseEmergencyConfig, syncState, type AlertView, type HazardView, type PlanView, type ResourceView } from './emergency';

/**
 * The emergency page's pure pieces: config parsing, feed staleness, and the
 * public sections rendered to HTML — checking the promises the page makes
 * to residents (alert text marked as English and shown as issued, severity
 * in words, tap-to-call numbers, unsafe links dropped, no "no alerts" claim
 * while the feed is stale — on the server, or on the device for a copy read
 * later). Database reads are covered in emergency-actions.test.ts.
 */

// Vitest compiles the components' JSX with the classic runtime (the web
// vitest config names no JSX runtime; Next uses its own), which expects
// React in scope.
vi.stubGlobal('React', React);

const config = emergencyConfigSchema.parse({
  nws_zones: ['NYC061'],
  alerts_signup_url: 'https://a858-nycnotify.nyc.gov/notifynyc/',
  alerts_signup_label: 'Notify NYC',
  emergency_phone: '911',
  info_phone: '311',
});

const alert: AlertView = {
  id: 'a1',
  sourceId: 'urn:a1',
  event: 'Heat Advisory',
  severity: 'Moderate',
  urgency: 'Expected',
  certainty: 'Likely',
  headline: 'Heat Advisory issued July 14 by NWS Upton NY',
  description: '* WHAT...Heat index values up to 100. Hot temperatures and\nhigh humidity may cause heat\nillnesses.\n\n* WHERE...New York (Manhattan).',
  instruction: 'Drink plenty of fluids.',
  areaDesc: 'New York (Manhattan)',
  senderName: 'NWS Upton NY',
  url: 'https://forecast.weather.gov/showsigwx.php?warnzone=NYZ072&warncounty=NYC061',
  effective: new Date('2026-07-14T07:10:00Z'),
  until: new Date('2026-07-16T00:00:00Z'),
  hazardSlugs: ['extreme-heat'],
};

const hazard: HazardView = {
  id: 'h1',
  slug: 'extreme-heat',
  name: 'Extreme heat',
  kind: 'extreme_heat',
  description: 'The deadliest weather hazard in the city.',
  likelihood: 5,
  severity: 4,
  risk: 20,
  band: 'very_high',
  dimensions: [{ dimension_slug: 'health', impact: 'high' }],
  nwsEvents: ['Heat Advisory'],
  displayOrder: 0,
  published: true,
  activeNow: true,
  activeUntil: new Date('2026-07-16T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
};

const updatedAt = new Date('2026-07-01T00:00:00Z');
const fresh = syncState({ lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastError: null }, new Date());
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe('emergency config and feed state', () => {
  it('falls back to defaults for a missing or invalid stored config, and says why', () => {
    expect(parseEmergencyConfig(undefined)).toEqual({ config: emergencyConfigSchema.parse({}), invalid: null });
    const bad = parseEmergencyConfig({ nws_zones: ['Manhattan'] });
    expect(bad.config.nws_zones).toEqual([]);
    expect(bad.invalid).toMatch(/^nws_zones\.0: use NWS UGC codes/);
  });

  it('is stale with no success, or a success older than half an hour', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(syncState(undefined, now).stale).toBe(true);
    const ok = syncState({ lastAttemptAt: now, lastSuccessAt: new Date('2026-07-15T11:45:00Z'), lastError: null }, now);
    expect(ok.stale).toBe(false);
    const old = syncState({ lastAttemptAt: now, lastSuccessAt: new Date('2026-07-15T11:00:00Z'), lastError: 'fetch failed' }, now);
    expect(old).toMatchObject({ stale: true, lastError: 'fetch failed' });
  });
});

describe('formatting', () => {
  it('shows alert times on the city clock in the reader’s language, naming the zone', () => {
    const t = new Date('2026-07-16T00:00:00Z');
    expect(formatAlertTime(t, 'en', 'America/New_York')).toBe('Jul 15, 2026, 8:00 PM EDT');
    expect(formatAlertTime(t, 'en', 'America/Los_Angeles')).toBe('Jul 15, 2026, 5:00 PM PDT');
    expect(formatAlertTime(t, 'es', 'America/New_York')).toMatch(/15 jul 2026/);
    // No Intl data for Haitian Creole: numeric, not English month names and AM/PM.
    expect(formatAlertTime(t, 'ht', 'America/New_York')).toBe('2026-07-15 20:00 EDT');
  });

  it('joins lists in the reader’s language, never with an English "and" where Intl has none', () => {
    const text = (locale: Parameters<typeof listParts>[0]) =>
      listParts(locale, 3)
        .map((p) => ('item' in p ? 'ABC'[p.item] : p.text))
        .join('');
    expect(text('en')).toBe('A, B, and C');
    expect(text('zh-Hans')).toBe('A、B和C');
    expect(text('ht')).toBe('A, B, C');
    expect(listParts('en', 1)).toEqual([{ item: 0 }]);
  });

  it('names plan languages in their own script, the reader’s first, English left out', () => {
    expect(planLanguageNames(['es', 'en', 'zh-Hant', 'yi'], 'zh-Hant')).toEqual([
      { code: 'zh-Hant', name: '繁體中文' },
      { code: 'es', name: 'Español' },
      { code: 'yi', name: 'ייִדיש' },
    ]);
  });
});

describe('public sections', () => {
  it('shows alerts as issued, marked English, with severity in words', () => {
    const out = html(
      createElement(AlertsSection, { m: en, locale: 'en', config, configured: true, alerts: [alert], sync: fresh, hazards: [hazard] }),
    );
    expect(out).toMatch(/<h3 id="alert-a1" lang="en"/);
    expect(out).toContain('>Moderate</span>');
    expect(out).toContain('Jul 14, 2026, 3:10 AM EDT until Jul 15, 2026, 8:00 PM EDT');
    expect(out).toContain('<details open=""');
    // A readable NWS page, not the API's JSON record.
    expect(out).toContain('href="https://forecast.weather.gov/showsigwx.php?warnzone=NYZ072&amp;warncounty=NYC061"');
    expect(out).toContain('Alerts are shown exactly as issued, in English.');
    expect(out).toContain('href="#hazard-extreme-heat"');
    // The NWS's hard line breaks are unwrapped; its paragraphs are kept.
    expect(out).toContain('Hot temperatures and high humidity may cause heat illnesses.\n\n* WHERE');
    // Nothing on the server is "ended": that is decided on the device.
    expect(out).not.toContain(en.emergency.alertEnded);
  });

  it('says when "no alerts" was true, so a copy read later is not a timeless claim', () => {
    const checkedAt = new Date('2026-07-15T20:00:00Z');
    const sync = syncState({ lastAttemptAt: checkedAt, lastSuccessAt: checkedAt, lastError: null }, checkedAt);
    const out = html(createElement(AlertsSection, { m: en, locale: 'en', config, configured: true, alerts: [], sync, hazards: [] }));
    expect(out).toContain('No active weather alerts for this area as of Jul 15, 2026, 4:00 PM EDT.');
  });

  it('never says "no alerts" while the feed is stale, and points to the NWS', () => {
    const stale = syncState(undefined, new Date());
    const out = html(createElement(AlertsSection, { m: en, locale: 'en', config, configured: true, alerts: [], sync: stale, hazards: [] }));
    expect(out).not.toContain(en.emergency.alertsNone);
    expect(out).toContain(en.emergency.alertsStale);
    expect(out).toContain('href="https://www.weather.gov/"');
    const notSet = html(createElement(AlertsSection, { m: en, locale: 'en', config, configured: false, alerts: [], sync: stale, hazards: [] }));
    expect(notSet).toContain(en.emergency.alertsNotConfigured);
  });

  it('turns the official numbers into tap-to-call links', () => {
    const out = html(createElement(GetAlertsSection, { m: en, config }));
    expect(out).toContain('href="tel:911"');
    expect(out).toContain('href="tel:311"');
    // The action in the reader's words, the program's proper name inside it.
    expect(out).toContain('Sign up for <span lang="en">Notify NYC</span>');
  });

  it('ranks threats with words for risk and impact, and links each to the doughnut', () => {
    const plan: PlanView = {
      id: 'p1', title: 'Heat plan', agency: 'Emergency Management', url: 'https://example.gov/heat', adoptedYear: 2024,
      summary: '', languages: [], hazardSlugs: ['extreme-heat'], displayOrder: 0, published: true, updatedAt,
    };
    const twoDimensions = { ...hazard, dimensions: [...hazard.dimensions, { dimension_slug: 'energy', impact: 'moderate' as const }] };
    const out = html(
      createElement(ThreatsSection, {
        m: en, locale: 'en', href: (p: string) => p, tenantSlug: 'nyc', hazards: [twoDimensions], plans: [plan], dimensions: [], selected: null,
      }),
    );
    expect(out).toContain('Very high risk');
    expect(out).toContain('Alert active now');
    expect(out).toContain('Likelihood 5 of 5 · Severity 4 of 5');
    expect(out).toContain('<span>Health (high impact)</span><span> and </span><span>Energy (moderate impact)</span>');
    expect(out).toContain('href="#plan-p1"');
    // In-page targets clear the sticky header.
    expect(out).toMatch(/<article id="hazard-extreme-heat"[^>]*class="[^"]*scroll-mt-48/);
  });

  it('drops links that are not http(s) and dials resources', () => {
    const plan: PlanView = {
      id: 'p2', title: 'Old plan', agency: 'Agency', url: 'javascript:alert(1)', adoptedYear: null,
      summary: 'Summary', languages: ['es'], hazardSlugs: [], displayOrder: 0, published: true, updatedAt,
    };
    const plans = html(createElement(PlansSection, { m: en, locale: 'en', plans: [plan] }));
    expect(plans).not.toContain('javascript:');
    // <bdi>: each name isolated, so neighbouring right-to-left names keep their order.
    expect(plans).toContain('Also published in: <span><bdi lang="es">Español</bdi></span>');
    const rtl = html(createElement(PlansSection, { m: en, locale: 'ht', plans: [{ ...plan, languages: ['ko', 'ar', 'ur'] }] }));
    expect(rtl).toContain('<bdi lang="ar">العربية</bdi></span><span>, </span><span><bdi lang="ur">اردو</bdi>');
    expect(rtl).not.toContain(' and ');

    const resource: ResourceView = {
      id: 'r1', name: 'Cooling centers', kind: 'cooling_center', description: 'Air-conditioned places to rest.',
      phone: '(212) 639-9675', url: null, hazardSlugs: ['extreme-heat', 'draft-hazard'], displayOrder: 0, published: true, updatedAt,
    };
    const help = html(createElement(HelpSection, { m: en, locale: 'en', resources: [resource], hazards: [hazard] }));
    expect(help).toContain('href="tel:2126399675"');
    expect(help).toContain('Cooling center');
    expect(help).not.toContain('draft-hazard');
  });
});

describe('alerts on the reader’s device (saved or fallback copies)', () => {
  const STALE = 30 * 60_000;
  const checked = '2026-07-15T20:00:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('keeps the server’s verdict until the copy itself is older than the stale threshold', () => {
    // Server render and hydration: the server's page, unchanged.
    expect(alertsNotice({ now: null, lastSuccessAt: checked, staleAfterMs: STALE, serverStale: false })).toBeNull();
    expect(alertsNotice({ now: null, lastSuccessAt: null, staleAfterMs: STALE, serverStale: true })).toBe('feed');
    // Read soon after: nothing to add.
    expect(alertsNotice({ now: at('2026-07-15T20:20:00Z'), lastSuccessAt: checked, staleAfterMs: STALE, serverStale: false })).toBeNull();
    // A copy saved on a calm day, opened days later in a storm.
    expect(alertsNotice({ now: at('2026-07-18T09:00:00Z'), lastSuccessAt: checked, staleAfterMs: STALE, serverStale: false })).toBe('copy');
    // The server already said the feed was down: its own notice stays.
    expect(alertsNotice({ now: at('2026-07-18T09:00:00Z'), lastSuccessAt: checked, staleAfterMs: STALE, serverStale: true })).toBe('feed');
  });

  it('marks an alert ended once its end time passes on the device clock', () => {
    expect(hasEnded('2026-07-16T00:00:00Z', null)).toBe(false);
    expect(hasEnded('2026-07-16T00:00:00Z', at('2026-07-15T23:59:00Z'))).toBe(false);
    expect(hasEnded('2026-07-16T00:00:00Z', at('2026-07-16T00:00:00Z'))).toBe(true);
    // No end given: it lasts until the feed drops it.
    expect(hasEnded(null, at('2030-01-01T00:00:00Z'))).toBe(false);
  });
});
