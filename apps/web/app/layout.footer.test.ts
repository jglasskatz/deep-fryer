import React, { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';

/**
 * The root layout's site-wide parts: the footer under every page but embeds
 * (SUPPORT_EMAIL as the contact, TERMS_URL only when set), and the product
 * pages' canonical URLs and social preview. The request is stubbed, as in
 * app/layout.test.ts; the footer's own content is SiteFooter.test.ts's.
 */

const en = () => ({ locale: 'en' as const, info: localeInfo('en'), m: messagesFor('en'), href: (p: string) => localizeHref('en', p) });
let requestPath = '/';
vi.mock('@/lib/i18n/server', () => ({
  getRequestPath: vi.fn(async () => requestPath),
  getI18n: vi.fn(async () => en()),
}));
vi.mock('@/app/login/i18n', () => ({ loginI18n: vi.fn(async () => en()) }));
vi.mock('@/lib/translation-policy', () => ({ translationOnFor: vi.fn(async () => false) }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@fontsource-variable/inter', () => ({}));

vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function page(path: string): Promise<string> {
  const { default: RootLayout } = await import('./layout');
  requestPath = path;
  const html = (await RootLayout({ children: createElement('main', { id: 'main' }, 'page') })) as ReactElement;
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, html));
}

describe('the root layout’s footer', () => {
  const saved = { SUPPORT_EMAIL: process.env.SUPPORT_EMAIL, TERMS_URL: process.env.TERMS_URL };
  beforeEach(() => {
    process.env.SUPPORT_EMAIL = 'help@city.example.gov';
    delete process.env.TERMS_URL;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('is under every page — landing, portraits, sign-in, legal pages — with the support address', async () => {
    for (const path of ['/', '/nyc', '/nyc/dim/housing', '/o/nyc/compare', '/pricing', '/login', '/privacy', '/accessibility']) {
      const html = await page(path);
      expect(html, path).toContain('<footer');
      expect(html, path).toContain('href="mailto:help@city.example.gov"');
      expect(html, path).toContain('Kate Raworth and Christian Guthier');
    }
  });

  it('links Terms only when TERMS_URL is set', async () => {
    expect(await page('/')).not.toContain('>Terms</a>');
    process.env.TERMS_URL = 'https://city.example.gov/terms';
    expect(await page('/')).toContain('href="https://city.example.gov/terms">Terms</a>');
  });

  it('is not inside an embed, which carries the credit itself', async () => {
    const html = await page('/embed/nyc');
    expect(html).not.toContain('<footer');
    expect(html).toContain('<main id="main">page</main>');
  });
});

describe('the root layout’s metadata for the product pages', () => {
  it('names the product pages’ own URL as canonical, and nothing for other English-only pages', async () => {
    const { generateMetadata } = await import('./layout');
    for (const path of ['/', '/pricing', '/privacy']) {
      requestPath = `${path}?utm_source=x`;
      expect((await generateMetadata()).alternates, path).toEqual({ canonical: path });
    }
    requestPath = '/login';
    expect((await generateMetadata()).alternates).toBeUndefined();
  });

  it('shares a social preview and a large-image card, leaving the title to each page', async () => {
    const { generateMetadata } = await import('./layout');
    requestPath = '/';
    const metadata = await generateMetadata();
    expect(metadata.openGraph).toMatchObject({
      siteName: 'deep-fryer',
      images: [{ url: '/social-preview.png', width: 1200, height: 630 }],
    });
    expect(metadata.openGraph).not.toHaveProperty('title');
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
    // Described, not used as a label (docs/OPEN-SOURCE.md §3.2(5)).
    expect(JSON.stringify(metadata)).not.toContain('Doughnut Economics');
  });
});
