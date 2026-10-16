import { describe, expect, it } from 'vitest';
import { productionEnvProblems, secretsKeyProblem } from './deploy-env.js';

describe('productionEnvProblems', () => {
  const ok = {
    DATABASE_URL: 'postgres://x',
    AUTH_SECRET: 's',
    APP_URL: 'https://app.example.gov',
    SMTP_URL: 'smtps://relay',
    EMAIL_FROM: 'a@b.c',
  };
  it('accepts a minimal complete deployment', () => {
    expect(productionEnvProblems(ok)).toEqual([]);
  });
  it('lists every problem at once', () => {
    const problems = productionEnvProblems({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_API_BASE: 'http://mock' });
    expect(problems).toHaveLength(6);
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
});
