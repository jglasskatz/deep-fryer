import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SIGN_IN_EMAIL_WINDOW_MS } from '@deep-fryer/db';
import { PRIVACY_SWEEP_CRONTAB } from '@deep-fryer/research';

/**
 * The privacy notice says how long the sign-in path keeps what it records
 * and what the service worker stores; each statement must be what the code
 * does. Once it promised sign-in entries went "once older than the limit's
 * window" while nothing deleted them for a day or more, and said only the
 * installed app's worker stored anything, and never a staff page's
 * content, while every browser's worker kept staff pages' images. These
 * pin the words to the numbers they rest on.
 */
vi.stubGlobal('React', React);
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  supportEmail: () => 'privacy@example.gov',
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function notice(): Promise<string> {
  const { default: PrivacyPage } = await import('./page');
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(PrivacyPage)));
  // Plain text, whitespace collapsed, entities read back.
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
}

describe('the privacy notice', () => {
  it('promises the deletion schedule the worker keeps: a quarter-hourly sweep past a one-hour window', async () => {
    expect(SIGN_IN_EMAIL_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(PRIVACY_SWEEP_CRONTAB.split(' ')[0]).toBe('*/15');
    const text = await notice();
    expect(text).toContain("Sign-in entries are deleted within about a quarter of an hour of leaving the limit's one-hour window.");
    expect(text).toContain(
      "An unused sign-in link's record, with the email address it was sent to, is deleted within about a quarter of an hour of the link expiring.",
    );
    expect(text).toContain('with any sign-in links sent to it that were never used');
  });

  it('says the service worker runs in any browser, stores images too, and nothing from signed-in or staff pages', async () => {
    const text = await notice();
    expect(text).toContain("This site's service worker — in any browser that supports one, not only the installed app —");
    expect(text).toContain('the images on them');
    expect(text).toContain('nothing on staff, account or billing pages — their images included — is saved');
    expect(text).not.toContain("The installed app's service worker");
  });
});
