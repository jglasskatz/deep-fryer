import { describe, expect, it } from 'vitest';
import { alertIsCurrent, emergencyConfigSchema, hazardsForAlert, nwsAlertsUrl, parseNwsAlerts, riskBand, riskScore } from './emergency.js';

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
