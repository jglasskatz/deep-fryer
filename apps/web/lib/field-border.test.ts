import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Form field edges (WCAG 1.4.11 Non-text Contrast). A text field's white
 * fill is 1.05:1 against the page, so its border is the only thing that
 * shows where the field is: it must reach 3:1 against the page and against
 * the field's own fill, in both themes. The colour is one token,
 * --color-field-border in app/globals.css, used as `border-field-border`;
 * this file checks the token's contrast and that no field goes back to the
 * faint `border-black/20` it replaced (1.54:1 light, 2.0:1 dark).
 */

const WEB = path.resolve(__dirname, '..');
const GLOBALS = readFileSync(path.join(WEB, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const NON_TEXT = 3;

type RGB = [number, number, number];
const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A `--name: #rrggbb;` declaration inside the given CSS text. */
function hexVar(css: string, name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css);
  if (!m) throw new Error(`globals.css: ${name} must be a #rrggbb value`);
  return m[1]!;
}

/** The brace-balanced body of the first block whose header contains `header`. */
function block(css: string, header: string): string {
  const open = css.indexOf('{', css.indexOf(header));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`missing block: ${header}`);
}

const LIGHT = block(GLOBALS, '@theme');
const DARK = block(GLOBALS, '@variant dark');

describe('form field border token', () => {
  it('is defined for both themes', () => {
    expect(hexVar(LIGHT, '--color-field-border')).toMatch(/^#/);
    expect(hexVar(DARK, '--color-field-border')).toMatch(/^#/);
  });

  it.each([
    ['light', LIGHT, '#ffffff'],
    // In dark mode `bg-white` is the raised surface, --color-white.
    ['dark', DARK, null],
  ] as const)('reaches 3:1 against the page and the field fill in %s', (_theme, css, fill) => {
    const border = hexVar(css, '--color-field-border');
    const page = hexVar(css, '--color-bg');
    const surface = fill ?? hexVar(css, '--color-white');
    expect(contrast(border, page)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast(border, surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

/* -------------------------------------------- fields use the token */

const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'coverage']);
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') ? [] : tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** A translucent black border: too faint for a field edge at any opacity the app uses. */
const FAINT_BORDER = /(?<![\w-])border-black\/\S+/;

/**
 * Class strings that style a field: literal classNames on an <input>,
 * <select> or <textarea> (up to the end of its opening tag, or the select's
 * options), and the shared `const field = '…'` / `const input = '…'` strings
 * that components pass as className.
 */
function fieldClassStrings(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<(input|select|textarea)\b/g)) {
    const rest = text.slice(m.index);
    const ends = ['/>', '</select', '</textarea'].map((e) => rest.indexOf(e)).filter((i) => i > 0);
    const tag = rest.slice(0, Math.min(...ends, rest.length));
    for (const c of tag.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) found.push(c[1] ?? c[2]!);
  }
  for (const m of text.matchAll(/const (?:field|input)\s*=\s*['`]([^'`]*)['`]/g)) found.push(m[1]!);
  return found;
}

describe('form fields', () => {
  it('the scan finds faint borders where they are written', () => {
    const sample = `
      const field = 'w-full rounded border border-black/20 bg-white';
      <input type="email" onChange={(e) => set(e.target.value)} className="rounded border border-black/15" />
      <select className="rounded border border-field-border"><option>a</option></select>`;
    expect(fieldClassStrings(sample).filter((c) => FAINT_BORDER.test(c))).toEqual([
      'rounded border border-black/15',
      'w-full rounded border border-black/20 bg-white',
    ]);
  });

  it('every field edge uses border-field-border, not a faint translucent black', () => {
    const files = [...tsxFiles(path.join(WEB, 'app')), ...tsxFiles(path.join(WEB, 'components'))];
    const faint = files.flatMap((file) =>
      fieldClassStrings(readFileSync(file, 'utf8'))
        .filter((c) => FAINT_BORDER.test(c))
        .map((c) => `${path.relative(WEB, file)}: ${c}`),
    );
    // Sanity: the scan does see the app's fields.
    const fields = files.flatMap((file) => fieldClassStrings(readFileSync(file, 'utf8')));
    expect(fields.filter((c) => c.includes('border-field-border')).length).toBeGreaterThan(20);
    expect(faint).toEqual([]);
  });
});
