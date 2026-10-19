import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS } from '@deep-fryer/core';
import { LOCALE_PREFIXES } from './locales';
import { isLocalizablePath, localizeHref, splitLocale } from './routing';

describe('i18n routing', () => {
  it('translates the public plane and nothing else', () => {
    for (const p of ['/nyc', '/nyc/progress', '/nyc/methodology', '/nyc/outreach', '/nyc/emergency', '/nyc/dim/housing', '/o/nyc', '/o/nyc/compare', '/o/nyc/insights', '/o/nyc/progress', '/embed/nyc']) {
      expect(isLocalizablePath(p), p).toBe(true);
    }
    for (const p of ['/', '/login', '/account', '/pricing', '/start', '/api/v1/portraits/nyc', '/nyc/admin', '/nyc/admin/review', '/nyc/admin/policy', '/nyc/admin/emergency', '/o/nyc/billing', '/o', '/invite/abc', '/nyc/dim', '/nyc/dim/housing/x', '/es/nyc']) {
      expect(isLocalizablePath(p), p).toBe(false);
    }
  });

  it('splits a locale prefix off the path, case-insensitively', () => {
    expect(splitLocale('/es/nyc/progress')).toEqual({ locale: 'es', path: '/nyc/progress' });
    expect(splitLocale('/ZH-Hant/o/nyc')).toEqual({ locale: 'zh-Hant', path: '/o/nyc' });
    expect(splitLocale('/ar')).toEqual({ locale: 'ar', path: '/' });
    expect(splitLocale('/nyc')).toEqual({ locale: null, path: '/nyc' });
    expect(splitLocale('/espanol/x')).toEqual({ locale: null, path: '/espanol/x' });
  });

  it('prefixes only public-plane hrefs, keeping query and hash', () => {
    expect(localizeHref('es', '/nyc/dim/housing?sort=new#c1')).toBe('/es/nyc/dim/housing?sort=new#c1');
    expect(localizeHref('ur', '/o/nyc/progress')).toBe('/ur/o/nyc/progress');
    expect(localizeHref('es', '/nyc/admin')).toBe('/nyc/admin');
    expect(localizeHref('es', '/api/v1/portraits/nyc/progress.csv')).toBe('/api/v1/portraits/nyc/progress.csv');
    expect(localizeHref('es', 'https://example.org/x')).toBe('https://example.org/x');
    expect(localizeHref('es', '//evil.example/x')).toBe('//evil.example/x');
    expect(localizeHref('en', '/nyc')).toBe('/nyc');
  });

  it('reserves every locale prefix as a slug, so no portrait can shadow a language', () => {
    for (const p of LOCALE_PREFIXES) expect(RESERVED_SLUGS.has(p), p).toBe(true);
  });
});
