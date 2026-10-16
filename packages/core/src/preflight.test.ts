import { describe, expect, it } from 'vitest';
import { parseDisabledFeatures } from './features.js';
import {
  alertCheckTargets,
  disabledFeaturesVerdict,
  oauthCredentialVerdict,
  storedApiKeysVerdict,
  stripeCatalogVerdict,
  stripeWebhookVerdict,
} from './preflight.js';

describe('preflight verdicts', () => {
  it('reads Google client validity from its answer to a bad code', () => {
    expect(oauthCredentialVerdict('invalid-code', 400, { error: 'invalid_grant', error_description: 'Malformed auth code.' }).status).toBe('pass');
    // Verified live: an unknown Google client is refused before the code is examined.
    expect(oauthCredentialVerdict('invalid-code', 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' }).status).toBe('fail');
    expect(oauthCredentialVerdict('invalid-code', 400, { error: 'redirect_uri_mismatch' }).status).toBe('fail');
  });

  it('never treats Entra’s bad-code answer as proof of valid credentials', () => {
    // Verified live: Entra answers AADSTS9002313 invalid_grant even for a client id that does not exist.
    const fakeClient = { error: 'invalid_grant', error_description: 'AADSTS9002313: Invalid request.' };
    expect(oauthCredentialVerdict('client-credentials', 400, fakeClient).status).toBe('warn');
    expect(oauthCredentialVerdict('client-credentials', 200, { access_token: 'eyJ…', token_type: 'Bearer' }).status).toBe('pass');
    expect(oauthCredentialVerdict('client-credentials', 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }).status).toBe('fail');
    expect(oauthCredentialVerdict('client-credentials', 400, { error: 'unauthorized_client', error_description: 'AADSTS700016: Application not found' }).status).toBe('fail');
  });

  it('refuses a catalog with a missing or zero price', () => {
    const keys = ['a', 'b', 'c'];
    const verdict = stripeCatalogVerdict(keys, [
      { lookup_key: 'a', active: true, unit_amount: 120000 },
      { lookup_key: 'b', active: true, unit_amount: 0 },
      { lookup_key: 'c', active: false, unit_amount: 5000 },
    ]);
    expect(verdict.status).toBe('fail');
    expect(verdict.detail).toContain('b: amount is 0');
    expect(verdict.detail).toContain('c: no active price');
    expect(stripeCatalogVerdict(['a'], [{ lookup_key: 'a', active: true, unit_amount: 1 }]).status).toBe('pass');
  });

  it('requires the webhook at this deployment with every synced event', () => {
    const url = 'https://app.example.gov/api/billing/webhook';
    expect(stripeWebhookVerdict(url, ['invoice.paid'], []).status).toBe('fail');
    expect(stripeWebhookVerdict(url, ['invoice.paid', 'invoice.payment_failed'], [{ url, status: 'enabled', enabled_events: ['invoice.paid'] }]).detail).toContain('invoice.payment_failed');
    expect(stripeWebhookVerdict(url, ['invoice.paid'], [{ url, status: 'disabled', enabled_events: ['*'] }]).status).toBe('fail');
    expect(stripeWebhookVerdict(url, ['invoice.paid'], [{ url, status: 'enabled', enabled_events: ['*'] }]).status).toBe('pass');
  });

  it('warns about kill-switch names that switch nothing off, and lists what is off', () => {
    const typo = disabledFeaturesVerdict('emergencies,policy_analysis');
    expect(typo.status).toBe('warn');
    expect(typo.detail).toContain('"emergencies"');
    expect(typo.detail).toContain('emergency');
    expect(disabledFeaturesVerdict('policy_analysis, deep_fry')).toEqual({
      status: 'pass',
      detail: 'off for the whole deployment: policy_analysis, deep_fry',
    });
    expect(disabledFeaturesVerdict(undefined)).toEqual({ status: 'pass', detail: 'no feature is off for the whole deployment' });
  });

  it('checks alerts only for portraits whose emergency view is on, as the worker polls them', () => {
    const zones = { nws_zones: ['NYC061', 'NYZ072'] };
    const rows = [
      { slug: 'on', emergency: zones, features: { emergency: true } },
      { slug: 'off', emergency: zones, features: { emergency: false } },
      { slug: 'unset', emergency: zones, features: null },
      { slug: 'broken-off', emergency: { nws_zones: 'NYC061' }, features: {} },
      { slug: 'broken-on', emergency: { nws_zones: 'NYC061' }, features: { emergency: true } },
      { slug: 'no-zones', emergency: { nws_zones: [] }, features: { emergency: true } },
    ];
    expect(alertCheckTargets(rows, new Set())).toEqual({
      portraits: [{ slug: 'on', zones: ['NYC061', 'NYZ072'] }],
      invalid: ['broken-on'],
    });
    // Switched off for the whole deployment: nothing is polled, so nothing is checked.
    expect(alertCheckTargets(rows, parseDisabledFeatures('emergency').disabled)).toEqual({ portraits: [], invalid: [] });
  });

  it('warns when organizations have keys on file that this deployment cannot read', () => {
    expect(storedApiKeysVerdict(0, false).status).toBe('pass');
    expect(storedApiKeysVerdict(2, true).status).toBe('pass');
    const lost = storedApiKeysVerdict(2, false);
    expect(lost.status).toBe('warn');
    expect(lost.detail).toMatch(/2 organization\(s\).*DF_SECRETS_KEY is not set/);
  });
});
