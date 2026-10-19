import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { AccountOverview } from '@/lib/account-data';

/**
 * The account page's way to a portrait of one's own. There is no trial
 * ("No free trials for making donuts, but free to view"), so it offers
 * setting one up as free to set up and paid to build — and only where the
 * deployment has self-serve start (the self_serve feature); otherwise /start
 * is a 404 and the page points to an invitation instead. The person and
 * their account are stubbed.
 */
vi.stubGlobal('React', React);

let overview: AccountOverview;
const person = (over: Partial<AccountOverview> = {}): AccountOverview => ({
  user: { id: 'u-1', email: 'clerk@example.gov', name: null, displayName: null },
  providers: [],
  organizations: [],
  portraits: [],
  ...over,
});
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/account/ProfileForm', () => ({ ProfileForm: () => null }));
vi.mock('@/components/account/DangerZone', () => ({ DangerZone: () => null }));
vi.mock('@/auth', () => ({ signIn: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  getAuth: vi.fn(async () => ({ userId: 'u-1', email: 'clerk@example.gov', isStaff: false, devMode: false })),
}));
vi.mock('@/lib/account-data', () => ({ accountOverview: vi.fn(async () => overview) }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  hasDatabase: () => true,
  googleConfigured: () => false,
  microsoftConfigured: () => false,
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function accountPage(disabled?: string): Promise<string> {
  if (disabled) process.env.DF_DISABLED_FEATURES = disabled;
  else delete process.env.DF_DISABLED_FEATURES;
  (await import('@/lib/features')).resetDeploymentDisabledForTests();
  const { default: AccountPage } = await import('./page');
  const element = await AccountPage();
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element)).replace(/<!-- -->/g, '');
}

describe('the account page and starting a portrait', () => {
  afterEach(async () => {
    delete process.env.DF_DISABLED_FEATURES;
    (await import('@/lib/features')).resetDeploymentDisabledForTests();
  });

  const cases = {
    'a resident': () => person(),
    'staff without an organization': () =>
      person({ portraits: [{ slug: 'ithaca', name: 'Ithaca', role: 'editor', organizationName: 'City of Ithaca' }] }),
  };

  for (const [who, make] of Object.entries(cases)) {
    it(`offers ${who} a portrait that is free to set up and paid to build — never a trial`, async () => {
      overview = make();
      const html = await accountPage();
      expect(html).toContain('href="/start"');
      expect(html).toMatch(/free to set up; building it needs a plan/);
      expect(html).not.toMatch(/trial/i);
    });

    it(`sends ${who} to an invitation, with no link to /start, where self-serve start is off`, async () => {
      overview = make();
      const html = await accountPage('self_serve');
      expect(html).not.toContain('href="/start"');
      expect(html).toMatch(/portrait(&#x27;|')?s? owner for an invitation/);
      expect(html).not.toMatch(/trial/i);
    });
  }
});
