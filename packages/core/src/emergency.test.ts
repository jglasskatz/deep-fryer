import { describe, expect, it } from 'vitest';
import {
  alertIsCurrent,
  canonicalLanguageTag,
  emergencyConfigSchema,
  emergencyPlanInputSchema,
  emergencyResourceInputSchema,
  hazardInputSchema,
  hazardsForAlert,
  isAlertsFeed,
  isHttpsUrl,
  isTimeZone,
  nwsAlertsUrl,
  nwsFeedVerdict,
  nwsRequestHeaders,
  nwsUserAgent,
  parseNwsAlerts,
  phoneSchema,
  riskBand,
  riskScore,
  telHref,
} from './emergency.js';

const feature = (props: Record<string, unknown>, id = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc') => ({
  id,
  type: 'Feature',
  properties: {
    id: 'urn:oid:2.49.0.1.840.0.abc',
    event: 'Heat Advisory',
    severity: 'Moderate',
    urgency: 'Expected',
    certainty: 'Likely',
    headline: 'Heat Advisory issued July 14 at 3:10AM EDT until July 15 at 8:00PM EDT by NWS Upton NY',
    description: '* WHAT...Heat index values up to 100 expected.',
    instruction: 'Drink plenty of fluids, stay in an air-conditioned room.',
    areaDesc: 'New York (Manhattan); Kings (Brooklyn)',
    senderName: 'NWS Upton NY',
    effective: '2026-07-14T03:10:00-04:00',
    expires: '2026-07-15T20:00:00-04:00',
    ends: null,
    status: 'Actual',
    messageType: 'Alert',
    ...props,
  },
});

describe('risk', () => {
  it('scores likelihood × severity and bands it', () => {
    expect(riskScore(5, 5)).toBe(25);
    expect([riskBand(4), riskBand(5), riskBand(10), riskBand(20)]).toEqual(['low', 'moderate', 'high', 'very_high']);
    expect(() => riskScore(0, 3)).toThrow();
    expect(() => riskScore(2.5, 3)).toThrow();
  });
});

describe('NWS alerts', () => {
  it('keeps actual alerts, drops tests/exercises and malformed features, orders by severity', () => {
    const { alerts, rejected } = parseNwsAlerts({
      features: [
        feature({}),
        feature({ id: 'x2', event: 'Coastal Flood Warning', severity: 'Severe' }),
        feature({ id: 'x3', status: 'Test' }),
        feature({ id: 'x4', status: 'Exercise' }),
        { properties: { event: 'no id' } },
      ],
    });
    expect(alerts.map((a) => a.event)).toEqual(['Coastal Flood Warning', 'Heat Advisory']);
    expect(rejected).toBe(1);
    expect(alerts[1]!.url).toMatch(/^https:\/\/api\.weather\.gov\//);
  });

  it('never trusts a link outside api.weather.gov', () => {
    const { alerts } = parseNwsAlerts({ features: [feature({}, 'https://evil.example/alert')] });
    expect(alerts[0]!.url).toBe('https://www.weather.gov/');
  });

  it('builds one request for the configured UGC zones and refuses junk', () => {
    expect(nwsAlertsUrl(['NYC061', 'NYZ072', 'bad'])).toBe('https://api.weather.gov/alerts/active?zone=NYC061,NYZ072');
    expect(() => nwsAlertsUrl(['nope'])).toThrow();
  });

  it('matches alerts to hazards by NWS event name', () => {
    const hazards = [{ slug: 'heat', nws_events: ['Heat Advisory', 'Excessive Heat Warning'] }, { slug: 'coastal', nws_events: ['Coastal Flood Warning'] }];
    expect(hazardsForAlert('heat advisory', hazards).map((h) => h.slug)).toEqual(['heat']);
    expect(hazardsForAlert('Tornado Warning', hazards)).toEqual([]);
  });

  it('treats an alert as current until it expires or ends', () => {
    const now = new Date('2026-07-15T12:00:00-04:00');
    expect(alertIsCurrent({ expires: '2026-07-15T20:00:00-04:00', ends: null }, now)).toBe(true);
    expect(alertIsCurrent({ expires: '2026-07-15T08:00:00-04:00', ends: null }, now)).toBe(false);
    expect(alertIsCurrent({ expires: '2026-07-15T08:00:00-04:00', ends: '2026-07-16T08:00:00-04:00' }, now)).toBe(true);
  });
});

describe('emergency config', () => {
  it('requires UGC codes and https sign-up links', () => {
    expect(emergencyConfigSchema.safeParse({ nws_zones: ['NYC061'], alerts_signup_url: 'https://a858-nycnotify.nyc.gov/' }).success).toBe(true);
    expect(emergencyConfigSchema.safeParse({ nws_zones: ['Manhattan'] }).success).toBe(false);
    expect(emergencyConfigSchema.safeParse({ alerts_signup_url: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('emergency config time zone', () => {
  it('defaults to New York and stores the canonical IANA name', () => {
    expect(emergencyConfigSchema.parse({}).time_zone).toBe('America/New_York');
    expect(emergencyConfigSchema.parse({ time_zone: 'america/los_angeles' }).time_zone).toBe('America/Los_Angeles');
    expect(emergencyConfigSchema.parse({ time_zone: 'UTC' }).time_zone).toBe('UTC');
  });

  it('refuses unknown zones and fixed offsets', () => {
    expect(emergencyConfigSchema.safeParse({ time_zone: 'Mars/Olympus_Mons' }).success).toBe(false);
    expect(emergencyConfigSchema.safeParse({ time_zone: '+05:00' }).success).toBe(false);
    expect(emergencyConfigSchema.safeParse({ time_zone: '' }).success).toBe(false);
    expect(isTimeZone('Europe/Warsaw')).toBe(true);
  });

  it('keeps configs saved before the field existed valid', () => {
    const stored = { nws_zones: ['NYC061'], alerts_signup_url: null, alerts_signup_label: null, emergency_phone: '911', info_phone: '311' };
    expect(emergencyConfigSchema.parse(stored)).toMatchObject({ ...stored, time_zone: 'America/New_York' });
  });
});

describe('phones and links', () => {
  it('accepts numbers people write and dials them', () => {
    for (const p of ['911', '311', '(212) 639-9675', '+1 212.639.9675', '*311']) {
      expect(phoneSchema.safeParse(p).success, p).toBe(true);
    }
    expect(telHref('(212) 639-9675')).toBe('tel:2126399675');
    expect(telHref('+1 212 639 9675')).toBe('tel:+12126399675');
    expect(telHref('call us')).toBeNull();
    expect(phoneSchema.safeParse('call 311').success).toBe(false);
    expect(phoneSchema.safeParse('12').success).toBe(false);
  });

  it('allows only full https links', () => {
    expect(isHttpsUrl('https://www.nyc.gov/site/em/index.page')).toBe(true);
    expect(isHttpsUrl('http://www.nyc.gov/')).toBe(false);
    expect(isHttpsUrl('https://user:pw@nyc.gov/')).toBe(false);
    expect(isHttpsUrl('https://localhost/')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('curated records', () => {
  const hazard = {
    slug: 'extreme-heat',
    name: 'Extreme heat',
    kind: 'extreme_heat',
    likelihood: 5,
    severity: 4,
    dimensions: [{ dimension_slug: 'health', impact: 'high' }],
    nws_events: ['Heat Advisory', 'heat advisory', 'Excessive Heat Warning'],
  };

  it('validates hazards and dedupes NWS event names case-insensitively', () => {
    const parsed = hazardInputSchema.parse(hazard);
    expect(parsed.nws_events).toEqual(['heat advisory', 'Excessive Heat Warning']);
    expect(parsed).toMatchObject({ description: '', display_order: 0, published: false });
    expect(hazardInputSchema.safeParse({ ...hazard, slug: 'Extreme Heat' }).success).toBe(false);
    expect(hazardInputSchema.safeParse({ ...hazard, slug: 'heat--wave' }).success).toBe(false);
    expect(hazardInputSchema.safeParse({ ...hazard, likelihood: 6 }).success).toBe(false);
    expect(hazardInputSchema.safeParse({ ...hazard, severity: 0 }).success).toBe(false);
    expect(hazardInputSchema.safeParse({ ...hazard, kind: 'volcano' }).success).toBe(false);
    expect(hazardInputSchema.safeParse({ ...hazard, dimensions: [{ dimension_slug: 'vibes', impact: 'high' }] }).success).toBe(false);
    const twice = [{ dimension_slug: 'health', impact: 'high' }, { dimension_slug: 'health', impact: 'low' }];
    expect(hazardInputSchema.safeParse({ ...hazard, dimensions: twice }).success).toBe(false);
  });

  it('canonicalizes plan languages and refuses non-https plan links', () => {
    const plan = { title: 'Hazard Mitigation Plan', agency: 'Emergency Management', url: 'https://example.gov/hmp' };
    expect(emergencyPlanInputSchema.parse({ ...plan, languages: ['ES', 'zh-hant', 'es'] }).languages).toEqual(['es', 'zh-Hant']);
    expect(emergencyPlanInputSchema.safeParse({ ...plan, languages: ['not a language'] }).success).toBe(false);
    expect(emergencyPlanInputSchema.safeParse({ ...plan, url: 'http://example.gov/hmp' }).success).toBe(false);
    expect(canonicalLanguageTag('ht')).toBe('ht');
  });

  it('lets resources omit a website but never carry a non-https one', () => {
    const resource = { name: 'Cooling center', kind: 'cooling_center', phone: '311' };
    expect(emergencyResourceInputSchema.parse(resource)).toMatchObject({ url: null, hazard_slugs: [] });
    expect(emergencyResourceInputSchema.safeParse({ ...resource, url: 'ftp://example.gov' }).success).toBe(false);
    expect(emergencyResourceInputSchema.safeParse({ ...resource, kind: 'spa' }).success).toBe(false);
  });
});

describe('NWS requests', () => {
  it('identifies the app with a contact, preferring SUPPORT_EMAIL', () => {
    expect(nwsUserAgent({ APP_URL: 'https://app.example.gov/', SUPPORT_EMAIL: 'help@example.gov' })).toBe(
      'deep-fryer/1.0 (https://app.example.gov; contact help@example.gov)',
    );
    expect(nwsUserAgent({ APP_URL: 'https://app.example.gov', EMAIL_FROM: 'deep-fryer <no-reply@example.gov>' })).toBe(
      'deep-fryer/1.0 (https://app.example.gov; contact no-reply@example.gov)',
    );
    expect(nwsUserAgent({})).toBe('deep-fryer/1.0');
    expect(nwsRequestHeaders({}).Accept).toBe('application/geo+json');
  });

  it('tells an empty feed from a body that is not the feed', () => {
    expect(isAlertsFeed({ features: [] })).toBe(true);
    expect(isAlertsFeed({ title: 'Service unavailable' })).toBe(false);
    expect(nwsFeedVerdict(['NYC061'], 200, { features: [feature({})] })).toEqual({ status: 'pass', detail: 'NYC061: 1 active alert(s)' });
    expect(nwsFeedVerdict(['NYC061'], 503, {}).status).toBe('fail');
    expect(nwsFeedVerdict(['NYC061'], 200, '<html>').status).toBe('fail');
  });
});
