import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALE_PREFIXES } from './locales';

/** public/embed.js runs on customers' sites and cannot import the locale list. */
describe('embed loader', () => {
  it('accepts exactly the app’s language prefixes for data-lang', () => {
    const src = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    const list = /var LANGS = (\[[^\]]*\]);/.exec(src)?.[1];
    expect(list).toBeDefined();
    expect(JSON.parse(list!.replace(/'/g, '"'))).toEqual([...LOCALE_PREFIXES]);
  });
});
