import { describe, expect, it } from 'vitest';
import { productionEnvProblems } from './deploy-env.js';

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
});
