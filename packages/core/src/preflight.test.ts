import { describe, expect, it } from 'vitest';
import { parseDisabledFeatures } from './features.js';
import {
  addressDomain,
  alertCheckTargets,
  anthropicModelVerdict,
  appRoleVerdict,
  contactAddressesVerdict,
  disabledFeaturesVerdict,
  errorDetail,
  modelAliasVerdict,
  modelLookupId,
  termsUrlToCheck,
  oauthCredentialVerdict,
  researchKeyMissingVerdict,
  researchModels,
  sampleDataVerdict,
  showcaseVerdict,
  smtpLoginConfigured,
  smtpVerifiedVerdict,
  storedApiKeysVerdict,
  stripeCatalogVerdict,
  stripeWebhookVerdict,
  termsUrlVerdict,
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

  it('fails a database restored without its roles even after the role is created by hand', () => {
    const migrated = { exists: true, bypass: false, member: true, readsTenants: true, insertGuard: true, ownerLockPublic: false };
    expect(appRoleVerdict(migrated).status).toBe('pass');
    // A plain pg_restore into a cluster without the roles.
    const restored = appRoleVerdict({ exists: false, bypass: null, member: null, readsTenants: null, insertGuard: false, ownerLockPublic: true });
    expect(restored.status).toBe('fail');
    expect(restored.detail).toContain('restore again into a fresh database');
    // The same database after CREATE ROLE deep_fryer_app ...; GRANT deep_fryer_app TO deep_fryer:
    // the old check passed it (exists, no BYPASSRLS, assumable) while every portrait page was a 500.
    const patched = appRoleVerdict({ ...migrated, readsTenants: false, insertGuard: false, ownerLockPublic: true });
    expect(patched.status).toBe('fail');
    expect(patched.detail).toContain('cannot read tenants');
    expect(patched.detail).toContain('research_runs_app_insert_planned');
    expect(patched.detail).toContain('PUBLIC can execute lock_tenant_owners');
    expect(appRoleVerdict({ ...migrated, ownerLockPublic: null }).detail).toContain('lock_tenant_owners missing');
    expect(appRoleVerdict({ ...migrated, bypass: true }).detail).toContain('BYPASSRLS');
    expect(appRoleVerdict({ ...migrated, member: false }).detail).toContain('cannot SET ROLE');
  });

  // What Node's fetch actually throws: a bare "fetch failed" whose reason is
  // only in the cause (shapes copied from Node 22/24 failures).
  it('keeps the cause of a failed fetch, not just "fetch failed"', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8443'), { code: 'ECONNREFUSED' });
    expect(errorDetail(new TypeError('fetch failed', { cause: refused }))).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:8443');
    const untrusted = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(errorDetail(new TypeError('fetch failed', { cause: untrusted }))).toBe(
      'fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)',
    );
    // Every address of the host refused: an AggregateError with no message of its own.
    const both = Object.assign(
      new AggregateError([new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')], ''),
      { code: 'ECONNREFUSED' },
    );
    expect(errorDetail(new TypeError('fetch failed', { cause: both }))).toBe(
      'fetch failed: connect ECONNREFUSED ::1:443; connect ECONNREFUSED 127.0.0.1:443',
    );
    expect(errorDetail(new Error('NoSuchBucket\nstack-ish detail'))).toBe('NoSuchBucket');
    expect(errorDetail('plain string')).toBe('plain string');
    expect(errorDetail(new Error('x'.repeat(400)))).toHaveLength(220);
  });

  it('warns about placeholder sender and support addresses, and a support address that cannot be a mailto link', () => {
    expect(addressDomain('deep-fryer <no-reply@Example.gov>')).toBe('example.gov');
    expect(addressDomain('help@city.gov')).toBe('city.gov');
    expect(addressDomain('nobody')).toBeNull();
    // What .env.example ships.
    const shipped = contactAddressesVerdict({ EMAIL_FROM: 'deep-fryer <no-reply@example.gov>', SUPPORT_EMAIL: 'support@example.gov' });
    expect(shipped.status).toBe('warn');
    expect(shipped.detail).toMatch(/EMAIL_FROM is on example\.gov.*SPF and DKIM/);
    expect(shipped.detail).toMatch(/SUPPORT_EMAIL is on example\.gov/);
    expect(contactAddressesVerdict({ SUPPORT_EMAIL: 'help@city.test' }).status).toBe('warn');
    expect(contactAddressesVerdict({ SUPPORT_EMAIL: 'Help Desk <help@city.gov>' }).detail).toMatch(/plain address/);
    // A real city whose name merely contains "example" is not a placeholder.
    expect(contactAddressesVerdict({ EMAIL_FROM: 'Doughnut <no-reply@cityofexample.gov>', SUPPORT_EMAIL: 'help@cityofexample.gov' })).toEqual({
      status: 'pass',
      detail: 'sender on cityofexample.gov, support on cityofexample.gov',
    });
  });

  it('says "no login configured" when SMTP_URL carries no credentials', () => {
    expect(smtpLoginConfigured('smtps://user:pass@smtp.city.gov:465')).toBe(true);
    expect(smtpLoginConfigured('smtp://relay.internal:25')).toBe(false);
    expect(smtpLoginConfigured('not a url')).toBe(false);
    expect(smtpVerifiedVerdict('smtps://user:pass@smtp.city.gov:465', 'x <a@city.gov>')).toEqual({
      status: 'pass',
      detail: 'connected and authenticated (x <a@city.gov>)',
    });
    const anonymous = smtpVerifiedVerdict('smtp://relay.internal:25', undefined);
    expect(anonymous.status).toBe('warn');
    expect(anonymous.detail).toContain('no login configured');
    expect(anonymous.detail).not.toContain('authenticated');
  });

  it('checks the models compose gives the worker, scouts only when set', () => {
    expect(researchModels({}).map((m) => [m.variable, m.model, m.fromDefault])).toEqual([
      ['ANTHROPIC_MODEL', 'claude-sonnet-5', true],
      ['VERIFIER_MODEL', 'claude-opus-5', true],
      ['ANTHROPIC_SMALL_FAST_MODEL', 'claude-haiku-4-5-20251001', true],
    ]);
    const custom = researchModels({ VERIFIER_MODEL: ' claude-opus-5-5 ', ANTHROPIC_MODEL: '  ', RESEARCH_SUBAGENT_MODEL: 'claude-sonnet-5' });
    expect(custom.find((m) => m.variable === 'VERIFIER_MODEL')).toMatchObject({ model: 'claude-opus-5-5', fromDefault: false });
    expect(custom.find((m) => m.variable === 'ANTHROPIC_MODEL')).toMatchObject({ model: 'claude-sonnet-5', fromDefault: true });
    expect(custom.at(-1)).toMatchObject({ role: 'scouts', variable: 'RESEARCH_SUBAGENT_MODEL', model: 'claude-sonnet-5' });
    expect(modelLookupId('claude-sonnet-5[1m]')).toBe('claude-sonnet-5');
    expect(modelLookupId('sonnet')).toBeNull();
    const alias = modelAliasVerdict({ role: 'scouts', variable: 'RESEARCH_SUBAGENT_MODEL', model: 'sonnet', fromDefault: false });
    expect(alias.status).toBe('warn');
    expect(alias.detail).toMatch(/^RESEARCH_SUBAGENT_MODEL=sonnet is a Claude Code alias/);
  });

  it('reads the Models API answer for each model with the fix for 401, 403 and 404', () => {
    const [researcher, verifier] = researchModels({ VERIFIER_MODEL: 'claude-opus-5-typo' });
    expect(anthropicModelVerdict(researcher!, 200, { type: 'model', id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' })).toEqual({
      status: 'pass',
      detail: "claude-sonnet-5 available to the deployment's key",
    });
    expect(anthropicModelVerdict(researcher!, 200, { id: 'claude-sonnet-5-20260101' }).detail).toContain('(as claude-sonnet-5-20260101)');
    const badKey = anthropicModelVerdict(researcher!, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    expect(badKey.status).toBe('fail');
    expect(badKey.detail).toMatch(/^ANTHROPIC_API_KEY was refused \(HTTP 401 authentication_error invalid x-api-key\)/);
    const forbidden = anthropicModelVerdict(researcher!, 403, { error: { type: 'permission_error', message: 'no access' } });
    expect(forbidden.status).toBe('fail');
    expect(forbidden.detail).toMatch(/may not use claude-sonnet-5.*set ANTHROPIC_MODEL in \.env/);
    const typo = anthropicModelVerdict(verifier!, 404, { error: { type: 'not_found_error', message: 'model: claude-opus-5-typo' } });
    expect(typo.status).toBe('fail');
    expect(typo.detail).toMatch(/correct VERIFIER_MODEL in \.env, or remove it to use the default \(claude-opus-5\)/);
    const scouts = researchModels({ RESEARCH_SUBAGENT_MODEL: 'claude-nope' }).at(-1)!;
    expect(anthropicModelVerdict(scouts, 404, null).detail).toContain('empty it to turn scouts off');
    expect(anthropicModelVerdict(researcher!, 529, { error: { type: 'overloaded_error', message: 'Overloaded' } }).status).toBe('warn');
  });

  it('warns, not fails, when the deployment has no research key', () => {
    const missing = researchKeyMissingVerdict();
    expect(missing.status).toBe('warn');
    expect(missing.detail).toMatch(/^not set: plan-funded research is off/);
  });

  it('warns before launch about sample data, a showcase that shows nothing, and the Terms link', () => {
    expect(sampleDataVerdict([]).status).toBe('pass');
    const demo = sampleDataVerdict(['nyc', 'manhattan']);
    expect(demo.status).toBe('warn');
    expect(demo.detail).toMatch(/2 portrait\(s\) hold seeded sample data \(nyc, manhattan\).*never promote a demo database/);

    expect(showcaseVerdict(undefined, null).status).toBe('pass');
    expect(showcaseVerdict('NYC', { organization: true, publicPortraits: 6 })).toEqual({
      status: 'pass',
      detail: 'organization "nyc": 6 public portrait(s) showcased',
    });
    expect(showcaseVerdict('nyc', { organization: true, publicPortraits: 0 }).detail).toMatch(/no public portrait yet/);
    expect(showcaseVerdict('nyx', { organization: false, publicPortraits: 0 }).detail).toMatch(/no organization "nyx"/);
    expect(showcaseVerdict('not a slug!', null).status).toBe('warn');

    expect(termsUrlVerdict(undefined, null).detail).toMatch(/^not set: the footer has no Terms link/);
    expect(termsUrlVerdict('javascript:alert(1)', null).detail).toMatch(/not an http\(s\) URL/);
    expect(termsUrlVerdict('https://city.gov/terms', 200)).toEqual({ status: 'pass', detail: 'https://city.gov/terms answers 200' });
    expect(termsUrlVerdict('https://city.gov/terms', 404).status).toBe('warn');
    expect(termsUrlToCheck(' https://city.gov/terms ')).toBe('https://city.gov/terms');
    expect(termsUrlToCheck('/terms')).toBeNull();
  });
});
