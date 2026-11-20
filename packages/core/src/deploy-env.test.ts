import { describe, expect, it } from 'vitest';
import { firstDoughnutChoice, firstDoughnutProblem, productionEnvProblems, secretsKeyProblem } from './deploy-env.js';

describe('productionEnvProblems', () => {
  const ok = {
    DATABASE_URL: 'postgres://x',
    AUTH_SECRET: 's',
    APP_URL: 'https://app.example.gov',
    SMTP_URL: 'smtps://relay',
    EMAIL_FROM: 'a@b.c',
    SUPPORT_EMAIL: 'help@city.gov',
  };
  it('accepts a minimal complete deployment', () => {
    expect(productionEnvProblems(ok)).toEqual([]);
  });
  it('lists every problem at once', () => {
    const problems = productionEnvProblems({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_API_BASE: 'http://mock' });
    expect(problems).toHaveLength(7);
  });
  // The footer, error pages and every refusal a customer reads end in this
  // address, so production does not start without one.
  it('requires SUPPORT_EMAIL, treating a blank one as unset, and says where it shows', () => {
    const { SUPPORT_EMAIL: _, ...withoutSupport } = ok;
    for (const env of [withoutSupport, { ...ok, SUPPORT_EMAIL: '' }, { ...ok, SUPPORT_EMAIL: '   ' }]) {
      const problems = productionEnvProblems(env);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^SUPPORT_EMAIL is required: .*footer.*error pages/);
    }
  });
  it('refuses a test Stripe server in production', () => {
    expect(productionEnvProblems({ ...ok, STRIPE_API_BASE: 'http://localhost:12111' })[0]).toMatch(/stripe-mock/);
  });

  // DF_SECRETS_KEY (SPEC-v7 §4) is optional — a deployment may not offer
  // bring-your-own-key — but a value that is set must be a real AES-256 key.
  it('does not require DF_SECRETS_KEY, and treats a blank one as unset', () => {
    expect(productionEnvProblems({ ...ok, DF_SECRETS_KEY: undefined })).toEqual([]);
    expect(productionEnvProblems({ ...ok, DF_SECRETS_KEY: '  ' })).toEqual([]);
  });
  it('accepts a 32-byte base64 DF_SECRETS_KEY (what openssl rand -base64 32 prints)', () => {
    const key = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i * 7)));
    expect(key).toHaveLength(44);
    expect(productionEnvProblems({ ...ok, DF_SECRETS_KEY: key })).toEqual([]);
    expect(productionEnvProblems({ ...ok, DF_SECRETS_KEY: `${key}\n` })).toEqual([]);
  });
  it('refuses a DF_SECRETS_KEY that is not base64 or not 32 bytes, without echoing it', () => {
    const short = btoa('sixteen byte key');
    expect(productionEnvProblems({ ...ok, DF_SECRETS_KEY: short })).toEqual([
      'DF_SECRETS_KEY must decode to 32 bytes, not 16 (generate one with: openssl rand -base64 32)',
    ]);
    const notBase64 = 'correct horse battery staple, definitely 32+ chars';
    const [problem] = productionEnvProblems({ ...ok, DF_SECRETS_KEY: notBase64 });
    expect(problem).toMatch(/must be base64/);
    expect(problem).not.toContain('horse');
    expect(secretsKeyProblem(btoa('x'.repeat(48)))).toMatch(/not 48/);
  });

  // How a group pays for its first doughnut: one named choice, `paid` unless the operator says otherwise.
  it('accepts DF_FIRST_DOUGHNUT unset, blank, paid or own', () => {
    for (const value of [undefined, '', '  ', 'paid', 'own', ' Own\n']) {
      expect(productionEnvProblems({ ...ok, DF_FIRST_DOUGHNUT: value })).toEqual([]);
    }
  });
  it('refuses a first-doughnut choice that is not built yet, or unknown, listing the accepted choices', () => {
    for (const value of ['approval', 'starter']) {
      expect(productionEnvProblems({ ...ok, DF_FIRST_DOUGHNUT: value })).toEqual([
        `DF_FIRST_DOUGHNUT=${value} is not available yet; accepted choices: paid, own (unset means paid)`,
      ]);
    }
    const [problem] = productionEnvProblems({ ...ok, DF_FIRST_DOUGHNUT: 'free-for-all' });
    expect(problem).toBe('DF_FIRST_DOUGHNUT must be one of the accepted choices: paid, own (unset means paid)');
    expect(firstDoughnutProblem({ DF_FIRST_DOUGHNUT: 'yes' })).toMatch(/paid, own/);
  });
});

describe('firstDoughnutChoice', () => {
  it('is paid unless the operator chose own', () => {
    expect(firstDoughnutChoice({})).toBe('paid');
    expect(firstDoughnutChoice({ DF_FIRST_DOUGHNUT: '' })).toBe('paid');
    expect(firstDoughnutChoice({ DF_FIRST_DOUGHNUT: 'paid' })).toBe('paid');
    expect(firstDoughnutChoice({ DF_FIRST_DOUGHNUT: 'own' })).toBe('own');
    expect(firstDoughnutChoice({ DF_FIRST_DOUGHNUT: ' OWN ' })).toBe('own');
  });
  it('reads a value it cannot use as paid, the stricter rule', () => {
    for (const value of ['approval', 'starter', 'free', 'owned']) {
      expect(firstDoughnutChoice({ DF_FIRST_DOUGHNUT: value })).toBe('paid');
    }
  });
});
