import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';

/**
 * The 404 page: in the language of the URL that missed, with the product
 * header (the footer comes from the root layout), and no canonical or
 * hreflang list pointing search engines at the missing address. A missing
 * embed is shown inside a city's page, so it gets no site header.
 */

vi.stubGlobal('React', React);

let requestPath = '/nope';
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({
    locale: 'en',
    info: localeInfo('en'),
    m: messagesFor('en'),
    href: (path: string) => localizeHref('en', path),
  })),
  getRequestPath: vi.fn(async () => requestPath),
}));
vi.mock('@/components/site-header/SiteHeader', () => ({
  SiteHeader: ({ variant }: { variant: string }) => createElement('header', { 'data-variant': variant }),
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function page(path: string): Promise<string> {
  requestPath = path;
  const { default: NotFound } = await import('./not-found');
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, await NotFound()));
}

describe('the 404 page', () => {
  beforeEach(() => {
    requestPath = '/nope';
  });

  it('names no canonical and no language versions, overriding the layout’s for the missing path', async () => {
    const { generateMetadata } = await import('./not-found');
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(messagesFor('en').notFound.title);
    expect(metadata).toHaveProperty('alternates', null);
  });

  it('carries the site header, and a way home', async () => {
    const html = await page('/no-such-portrait/dim/housing');
    expect(html).toContain('data-variant="landing"');
    expect(html).toContain(`>${messagesFor('en').notFound.home}</a>`);
  });

  it('has no site header inside an embed', async () => {
    const html = await page('/embed/no-such-portrait');
    expect(html).not.toContain('<header');
    expect(html).toContain(messagesFor('en').notFound.title);
  });
});
