import { Fragment, createElement, type ReactNode } from 'react';

/**
 * Message formatting without a library: `{name}` placeholders, CLDR plural
 * categories through Intl.PluralRules, and rich text where a placeholder
 * stands for a React element (a link inside a translated sentence, so
 * translators can move it to wherever their grammar puts it).
 */

/** Plural message: `other` is required; each language supplies the
 * categories Intl.PluralRules returns for it (Russian and Polish need
 * one/few/many/other, Arabic all six, Chinese and Korean only other). */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Vars = Record<string, string | number>;

export function fmt(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

export function fmtPlural(locale: string, forms: PluralForms, n: number, vars: Vars = {}): string {
  const category = new Intl.PluralRules(locale).select(n) as keyof PluralForms;
  return fmt(forms[category] ?? forms.other, { n, ...vars });
}

/**
 * `rich('{link} to join the discussion.', { link: <a …>Sign in</a> })`:
 * splits on placeholders and interleaves the given nodes. Unknown
 * placeholders are left as text.
 */
export function rich(template: string, parts: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const key = match[1]!;
    if (!(key in parts)) continue;
    out.push(template.slice(last, match.index));
    out.push(createElement(Fragment, { key: `${key}-${match.index}` }, parts[key]));
    last = match.index! + match[0].length;
  }
  out.push(template.slice(last));
  return createElement(Fragment, null, ...out);
}
