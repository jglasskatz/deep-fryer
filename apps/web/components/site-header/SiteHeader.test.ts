import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';

/**
 * The header on the sign-in pages (SPEC-v6 §2.2): those pages speak the
 * reader's remembered language although their URL has none, so the header
 * does too, and it leaves out the English-only product links.
 *
 * The request is stubbed: middleware's language for /login is always English
 * (getI18n), the reader's remembered one Spanish (loginI18n), and nobody is
 * signed in. SiteHeader is an async server component, so it is called for
 * its element tree, which renders like any other.
 */
const i18n = (code: 'en' | 'es') => ({
  locale: code,
  info: localeInfo(code),
  m: messagesFor(code),
  href: (path: string) => localizeHref(code, path),
});
let requestPath = '/login?next=%2Fnyc';
/** The language of the URL (getI18n): English for /login, Spanish for a /es/… page. */
let pageLocale: 'en' | 'es' = 'en';
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => i18n(pageLocale)),
  getRequestPath: vi.fn(async () => requestPath),
}));
vi.mock('@/app/login/i18n', () => ({ loginI18n: vi.fn(async () => i18n('es')) }));
vi.mock('@/lib/auth', () => ({
  getAuth: vi.fn(async () => ({ userId: null, email: null, name: null, displayName: null, isStaff: false, devMode: false })),
}));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  hasDatabase: () => true,
  authConfigured: () => true,
}));
vi.mock('@/auth', () => ({ signOut: vi.fn() }));

// Vitest compiles the components' JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function header(variant: 'sign-in' | 'landing'): Promise<string> {
  const { SiteHeader } = await import('./SiteHeader');
  const element = await SiteHeader({ variant });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

describe('SiteHeader on the sign-in pages', () => {
  it('speaks the reader’s language: skip link, sign-in link, theme menu', async () => {
    requestPath = '/login?next=%2Fnyc';
    const es = messagesFor('es');
    const html = await header('sign-in');
    expect(html).toContain(`>${es.common.skipToContent}</a>`);
    // "Sign in" keeps the page's own `next`.
    expect(html).toContain(`href="/login?next=%2Fnyc">${es.common.signIn}</a>`);
    expect(html).toContain(es.theme.label);
    expect(html).not.toContain(messagesFor('en').common.skipToContent);
  });

  it('carries none of the English-only product links', async () => {
    requestPath = '/login/check-email';
    const html = await header('sign-in');
    for (const label of ['Pricing', 'Start a portrait', 'My portraits']) expect(html).not.toContain(label);
    // The product's own pages keep them.
    requestPath = '/';
    expect(await header('landing')).toContain('Start a portrait');
  });
});

describe('SiteHeader’s product links', () => {
  afterEach(async () => {
    delete process.env.DF_DISABLED_FEATURES;
    (await import('@/lib/features')).resetDeploymentDisabledForTests();
    pageLocale = 'en';
  });

  it('carries no "Start a portrait" link where the deployment has no self-serve start, so it never leads to a 404', async () => {
    requestPath = '/';
    process.env.DF_DISABLED_FEATURES = 'self_serve';
    (await import('@/lib/features')).resetDeploymentDisabledForTests();
    const html = await header('landing');
    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain('Start a portrait');
    // Pricing stays: reading what plans cost needs no self-serve start.
    expect(html).toContain('href="/pricing"');
  });

  it('marks the English product links as English on a page in another language (a 404 under /es/…)', async () => {
    requestPath = '/es/nyc/dim/missing';
    pageLocale = 'es';
    const html = await header('landing');
    expect(html).toMatch(/<a[^>]*href="\/pricing"[^>]*lang="en"|<a[^>]*lang="en"[^>]*href="\/pricing"/);
    expect(html).toMatch(/<a[^>]*href="\/start"[^>]*lang="en"|<a[^>]*lang="en"[^>]*href="\/start"/);
    // On an English page they need no attribute of their own.
    pageLocale = 'en';
    expect(await header('landing')).not.toContain('lang="en"');
  });
});
