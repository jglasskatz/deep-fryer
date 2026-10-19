import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './locales';

/**
 * public/sw.js renders the offline page itself (no app code is available
 * offline), so it carries its own small table of translations keyed by URL
 * prefix. It must cover every language the app serves.
 */
describe('service worker offline page', () => {
  it('has text for every app language, with matching lang and dir', () => {
    const src = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const table = /const OFFLINE = (\{[\s\S]*?\n\});/.exec(src)?.[1];
    expect(table).toBeDefined();
    const OFFLINE = new Function(`return ${table}`)() as Record<string, { lang: string; dir: string; h1: string }>;
    for (const l of LOCALES) {
      const entry = OFFLINE[l.prefix || 'en'];
      expect(entry, l.code).toBeDefined();
      expect(entry!.lang).toBe(l.code);
      expect(entry!.dir).toBe(l.dir);
      expect(entry!.h1.length).toBeGreaterThan(0);
    }
    expect(Object.keys(OFFLINE)).toHaveLength(LOCALES.length);
  });
});
