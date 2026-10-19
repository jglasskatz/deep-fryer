import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/messages/en';
import { messagesFor } from '@/lib/i18n/messages';
import { confirmationFor, languageNameIn, RequestTranslation } from './RequestTranslation';

// Vitest compiles the component's JSX with the classic runtime, which expects
// React in scope (as in components/portrait/PortraitCoreView.test.ts).
vi.stubGlobal('React', React);

/** The confirmation names the requested language in the confirmation's own language. */
describe('languageNameIn', () => {
  it('names the language in the language of the sentence around it', () => {
    expect(languageNameIn('en', 'es', 'Español')).toBe('Spanish');
    expect(languageNameIn('en', 'zh-Hant', '繁體中文')).toBe('Traditional Chinese');
    expect(languageNameIn('es', 'bn', 'বাংলা')).toBe('bengalí');
  });

  it("falls back to the language's own name when the runtime cannot name it", () => {
    expect(languageNameIn('en', 'xx-unknown', 'Own name')).toBe('Own name');
    expect(languageNameIn('not a locale tag!', 'es', 'Español')).toBe('Español');
  });
});

describe('confirmationFor', () => {
  const labels = en.translationRequest;

  it('thanks the reader only for a request that was recorded', () => {
    expect(confirmationFor('sent', labels, 'Bengali')).toBe('Thank you. Staff will see that a reader asked for Bengali.');
  });

  it('says plainly when nothing was recorded, and why', () => {
    // An eleventh reader on shared Wi-Fi must not be told they were counted.
    expect(confirmationFor('limited', labels, 'Bengali')).toBe(labels.limited);
    expect(labels.limited).toMatch(/not recorded/);
    // Translated since the page loaded: there is nothing to ask for, so no "staff will see".
    expect(confirmationFor('not_needed', labels, 'Bengali')).toBe(labels.notNeeded);
    expect(labels.notNeeded).toMatch(/Reload/);
  });
});

describe('RequestTranslation', () => {
  /** The disclosure as an Arabic reader gets it: labels in Arabic on an English page. */
  const arabic = () =>
    renderToStaticMarkup(
      createElement(RequestTranslation, {
        tenantSlug: 'ithaca',
        path: '/ithaca',
        labels: messagesFor('ar').translationRequest,
        labelsLang: 'ar',
        labelsDir: 'rtl',
        languages: [
          { code: 'es', name: 'Español', dir: 'ltr' },
          { code: 'ar', name: 'العربية', dir: 'rtl' },
        ],
        initial: 'ar',
      }),
    );

  it('keeps the menu and its positioned panel in the page’s direction, so an RTL panel is not pushed off screen', () => {
    // `end-0` is resolved against the panel's own direction: an rtl panel
    // would be pinned at its left edge and grow off the right of the page.
    const html = arabic();
    expect(html).toMatch(/^<details name="df-header-menu" class="relative">/);
    expect(html).toMatch(/<div class="absolute end-0 [^"]*">/);
    expect(html).not.toMatch(/<(details|div class="absolute)[^>]*\bdir=/);
  });

  it('marks the reader’s-language text itself, so it is read and laid out as Arabic', () => {
    const html = arabic();
    expect(html).toContain(`<div lang="ar" dir="rtl"><p>${messagesFor('ar').translationRequest.intro}</p>`);
    expect(html.match(/<span class="[^"]*" lang="ar" dir="rtl">طلب ترجمة<\/span>/g)).toHaveLength(2);
  });
});
