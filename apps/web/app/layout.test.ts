import React, { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localeInfo, type Locale } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';

/**
 * The root layout's language-dependent output: hreflang alternates (SPEC-v7
 * §3.5: a page lists its translations only when its portrait is translated)
 * and <html lang/dir> (the sign-in pages speak the reader's remembered
 * language although their URL has none). The request — its path, its
 * language, the reader's remembered one — and the translation policy are
 * stubbed; the policy itself is tested in lib/translation-policy.test.ts.
 */
const i18n = (code: Locale) => ({
  locale: code,
  info: localeInfo(code),
  m: messagesFor(code),
  href: (path: string) => localizeHref(code, path),
});
let requestPath = '/';
let translated = true;
vi.mock('@/lib/i18n/server', () => ({
  getRequestPath: vi.fn(async () => requestPath),
  // Middleware's language: English on every unprefixed path.
  getI18n: vi.fn(async () => i18n('en')),
}));
// The language the reader last chose (the df_lang cookie).
vi.mock('@/app/login/i18n', () => ({ loginI18n: vi.fn(async () => i18n('ar')) }));
vi.mock('@/lib/translation-policy', () => ({ translationOnFor: vi.fn(async () => translated) }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
// The bundled font is a stylesheet, which only Next's bundler loads.
vi.mock('@fontsource-variable/inter', () => ({}));

// Vitest compiles the layout's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

describe('generateMetadata', () => {
  beforeEach(() => {
    translated = true;
  });

  it('lists every language for a translated portrait’s page, English as the default', async () => {
    const { generateMetadata } = await import('./layout');
    requestPath = '/nyc/dim/housing?x=1';
    const { alternates } = await generateMetadata();
    expect(alternates?.canonical).toBe('/nyc/dim/housing');
    expect(alternates?.languages).toMatchObject({ 'x-default': '/nyc/dim/housing', en: '/nyc/dim/housing', es: '/es/nyc/dim/housing' });
    expect(Object.keys(alternates?.languages ?? {})).toHaveLength(13);
  });

  it('names only the English page of a portrait whose translation is off, whose /es/… URLs redirect to English', async () => {
    const { generateMetadata } = await import('./layout');
    requestPath = '/ithaca/dim/housing';
    translated = false;
    const { alternates } = await generateMetadata();
    expect(alternates).toEqual({ canonical: '/ithaca/dim/housing' });
  });
});

describe('RootLayout', () => {
  async function html(path: string): Promise<ReactElement<{ lang: string; dir: string }>> {
    const { default: RootLayout } = await import('./layout');
    requestPath = path;
    return (await RootLayout({ children: null })) as ReactElement<{ lang: string; dir: string }>;
  }

  it('marks a sign-in page with the reader’s language, matching its localized title and header', async () => {
    for (const path of ['/login?next=%2Fnyc', '/login/check-email']) {
      expect((await html(path)).props).toMatchObject({ lang: 'ar', dir: 'rtl' });
    }
  });

  it('keeps every other page in the language its URL gives it', async () => {
    expect((await html('/pricing')).props).toMatchObject({ lang: 'en', dir: 'ltr' });
    expect((await html('/loginville')).props).toMatchObject({ lang: 'en', dir: 'ltr' });
  });
});
