import { describe, expect, it } from 'vitest';
import { oauthCredentialVerdict, stripeCatalogVerdict, stripeWebhookVerdict } from './preflight.js';

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
});
