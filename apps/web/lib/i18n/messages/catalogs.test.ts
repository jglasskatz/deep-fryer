import { describe, expect, it } from 'vitest';
import { LOCALES } from '../locales';
import { ALL_CATALOGS } from './index';
import { en } from './en';

/**
 * Every translation against the English source. The type system already
 * guarantees the same keys; these check what types cannot: placeholders
 * survive translation (a lost `{contact}` silently drops NYC's 311), each
 * plural message covers every category the language's grammar uses, and the
 * catalog is actually translated rather than English copied through.
 */

type Leaf = { path: string; en: unknown; tr: unknown };

function leaves(a: unknown, b: unknown, path: string[] = []): Leaf[] {
  if (typeof a === 'string' || isForms(a)) return [{ path: path.join('.'), en: a, tr: b }];
  return Object.keys(a as object).flatMap((k) =>
    leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k]),
  );
}

function isForms(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && ('other' in v || 'singular' in v);
}

const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));

describe.each(LOCALES.filter((l) => l.code !== 'en').map((l) => [l.code] as const))('catalog %s', (code) => {
  const all = leaves(en, ALL_CATALOGS[code]);

  it('keeps every placeholder and adds none', () => {
    for (const { path, en: src, tr } of all) {
      if (typeof src === 'string') {
        expect(typeof tr, path).toBe('string');
        expect(placeholders(tr as string), path).toEqual(placeholders(src));
        expect((tr as string).trim().length, path).toBeGreaterThan(0);
        continue;
      }
      const forms = tr as Record<string, string>;
      if ('singular' in (src as object)) {
        expect(forms.singular?.trim(), `${path}.singular`).toBeTruthy();
        expect(forms.plural?.trim(), `${path}.plural`).toBeTruthy();
        continue;
      }
      const wanted = placeholders((src as Record<string, string>).other!);
      for (const [cat, text] of Object.entries(forms)) {
        const got = placeholders(text);
        for (const p of got) expect(wanted.has(p), `${path}.${cat}: unknown {${p}}`).toBe(true);
        // A form may spell its number out ("one portrait"), but never drop a
        // non-count value such as {total}.
        for (const p of wanted) if (p !== 'n') expect(got.has(p), `${path}.${cat}: lost {${p}}`).toBe(true);
      }
      expect(placeholders(forms.other!).has('n') || !wanted.has('n'), `${path}.other needs {n}`).toBe(true);
    }
  });

  it("covers every plural category the language's grammar uses", () => {
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const { path, en: src, tr } of all) {
      if (typeof src === 'string' || 'singular' in (src as object)) continue;
      for (const cat of categories) {
        expect((tr as Record<string, string>)[cat], `${path}.${cat}`).toBeTruthy();
      }
    }
  });

  it('is translated, not English passed through', () => {
    const strings = all.filter((l) => typeof l.en === 'string');
    const same = strings.filter((l) => l.tr === l.en).map((l) => l.path);
    // Brand names and symbols may legitimately match; whole sections may not.
    expect(same.length / strings.length, same.join(', ')).toBeLessThan(0.1);
  });
});
