import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { en } from '@/lib/i18n/messages/en';
import { DOUGHNUT_LICENSE_URL } from './DoughnutCredit';
import { SiteFooter } from './SiteFooter';

/**
 * The site footer (every page but embeds): contact, accessibility, privacy,
 * terms only when the operator has some, and the Doughnut's attribution
 * (docs/OPEN-SOURCE.md §3.3). Rendered as the root layout renders it.
 */

// Vitest compiles the components' JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function footer(supportEmail: string | null, termsUrl: string | null): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(SiteFooter, { labels: en.footer, supportEmail, termsUrl }),
    ),
  );
}

describe('SiteFooter', () => {
  it('links contact, accessibility and privacy, and leaves out Terms when TERMS_URL is unset', () => {
    const html = footer('help@city.example.gov', null);
    expect(html).toContain('<footer');
    expect(html).toContain(`aria-label="${en.footer.label}"`);
    expect(html).toContain('href="mailto:help@city.example.gov"');
    // The address is shown, not only linked: a reader without a mail program can copy it.
    expect(html).toContain('>help@city.example.gov</a>');
    expect(html).toMatch(/href="\/accessibility"[^>]*>Accessibility<\/a>/);
    expect(html).toMatch(/href="\/privacy"[^>]*>Privacy<\/a>/);
    expect(html).not.toContain(`>${en.footer.terms}<`);
  });

  it('links Terms to TERMS_URL when the operator sets one', () => {
    const html = footer('help@city.example.gov', 'https://city.example.gov/terms');
    expect(html).toContain(`href="https://city.example.gov/terms">${en.footer.terms}</a>`);
  });

  it('drops the contact item rather than linking nowhere when no support address is configured (development)', () => {
    const html = footer(null, null);
    expect(html).not.toContain('mailto:');
    expect(html).toContain('href="/privacy"');
  });

  it('credits Raworth and Guthier under CC BY-SA 4.0 and says the site is not affiliated with DEAL', () => {
    const html = footer('help@city.example.gov', null);
    expect(html).toContain('Kate Raworth and Christian Guthier');
    expect(html).toContain(`href="${DOUGHNUT_LICENSE_URL}"`);
    expect(html).toContain('>CC BY-SA 4.0</a>');
    expect(html).toContain('Creating City Portraits');
    expect(html).toContain('not affiliated with or endorsed by Doughnut Economics Action Lab');
    // No placeholder survives into the page.
    expect(html).not.toMatch(/\{(license|book|method|email)\}/);
  });
});
