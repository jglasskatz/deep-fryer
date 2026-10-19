import { describe, expect, it } from 'vitest';
import { preferredLocale } from './preferred';

describe('preferredLocale', () => {
  it('prefers the language chosen on this site', () => {
    expect(preferredLocale('ko', 'es-US,es;q=0.9')).toBe('ko');
    expect(preferredLocale('en', 'es')).toBeNull();
  });

  it('otherwise takes the first browser language we have, in q order', () => {
    expect(preferredLocale(null, 'de-DE,ru;q=0.8,es;q=0.9')).toBe('es');
    expect(preferredLocale(null, 'en-US,en;q=0.9,es;q=0.8')).toBeNull();
    expect(preferredLocale(null, 'ht')).toBe('ht');
    expect(preferredLocale(null, '')).toBeNull();
    expect(preferredLocale(undefined, 'xx;q=1,fr;q=0')).toBeNull();
  });

  it('picks the Chinese script from the region or script subtag', () => {
    expect(preferredLocale(null, 'zh-TW')).toBe('zh-Hant');
    expect(preferredLocale(null, 'zh-HK,en;q=0.5')).toBe('zh-Hant');
    expect(preferredLocale(null, 'zh-Hant-US')).toBe('zh-Hant');
    expect(preferredLocale(null, 'zh-CN')).toBe('zh-Hans');
    expect(preferredLocale(null, 'zh')).toBe('zh-Hans');
  });
});
