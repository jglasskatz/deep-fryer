import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dark-mode coverage (SPEC-v5 §4): "a test fails if a component uses one
 * the remap does not cover". How the remap works is described at the top of
 * app/theme-dark.css; this test holds it to account by scanning the same
 * sources Tailwind scans for colour utilities:
 *
 * - every palette colour (`bg-red-100`, `border-s-sky-500`, …) has a dark
 *   value for its variable in theme-dark.css;
 * - every colour with an opacity modifier (`border-black/10`, `bg-amber-50/70`,
 *   `hover:bg-black/5`) has an old-engine remap, and that remap is exactly
 *   what modern engines compute from the dark variables;
 * - no colour utility carries a `dark:` variant (inside dark mode the names
 *   are already mirrored, so it would paint the opposite of what it says);
 * - no colour is written where the remap cannot reach it: an arbitrary value
 *   (`bg-[#000]`, `text-[rgb(0_0_0)]`) or an inline black/white literal
 *   (`style={{ background: 'rgba(0,0,0,.06)' }}`, `fill="white"`), except
 *   the few listed in FIXED_COLOURS with the reason they are fixed;
 * - the text/fill combinations the app uses reach WCAG AA (4.5:1) in dark;
 * - nothing in theme-dark.css applies outside the `dark` variant, so the
 *   light theme is untouched.
 *
 * Fixing a failure means adding the missing value or remap to
 * app/theme-dark.css, or writing the colour as a class or token
 * (`var(--color-bg)`) instead of a literal — the failure names the class or
 * literal and the file using it — not loosening this test.
 */

const WEB = path.resolve(__dirname, '..');
const THEME_DARK = readFileSync(path.join(WEB, 'app/theme-dark.css'), 'utf8');
const GLOBALS = readFileSync(path.join(WEB, 'app/globals.css'), 'utf8');

const AA = 4.5;

/* ---------------------------------------------------------------- sources */

/**
 * What Tailwind compiles classes from. globals.css imports Tailwind without
 * `source(…)` or `@source` (asserted below), so Tailwind auto-detects every
 * file under apps/web that git does not ignore — lib/ and middleware.ts as
 * much as app/ and components/. The scan walks the same tree, minus build
 * output and dependencies, and minus tests: their strings are expectations
 * and examples (this file names `dark:bg-red-950` above), never rendered.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'coverage']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|mdx|html)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') ? [] : sourceFiles(full);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [full] : [];
  });
}

const SOURCES = sourceFiles(WEB).map((file) => ({ file: path.relative(WEB, file), text: readFileSync(file, 'utf8') }));

const HUES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/**
 * A colour utility as written in source, variants and all. The lookbehind
 * refuses a start after `:` so `hover:bg-black/5` is captured whole rather
 * than as a bare `bg-black/5`.
 */
const COLOUR_CLASS = new RegExp(
  String.raw`(?<![\w\-/:.\[\]])((?:[a-z0-9-]+:)*)` +
    String.raw`(bg|text|border(?:-[xytrblse])?|ring|divide(?:-[xy])?|outline|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow)` +
    String.raw`-(black|white|(?:${HUES})-(?:50|[1-9]00|950))` +
    String.raw`(?:\/(\d{1,3}|\[[\d.]+\]))?(?![\w\-/\[])`,
  'g',
);

interface UsedClass {
  name: string;
  variants: string[];
  utility: string;
  colour: string;
  /** 0–1, or null without an opacity modifier. */
  alpha: number | null;
  files: Set<string>;
}

function scanClasses(): Map<string, UsedClass> {
  const found = new Map<string, UsedClass>();
  for (const { file, text } of SOURCES) {
    for (const m of text.matchAll(COLOUR_CLASS)) {
      const name = m[0];
      const entry =
        found.get(name) ??
        ({
          name,
          variants: m[1] ? m[1].slice(0, -1).split(':') : [],
          utility: m[2]!,
          colour: m[3]!,
          alpha: m[4] === undefined ? null : m[4].startsWith('[') ? Number(m[4].slice(1, -1)) : Number(m[4]) / 100,
          files: new Set<string>(),
        } satisfies UsedClass);
      entry.files.add(file);
      found.set(name, entry);
    }
  }
  return found;
}

const USED = [...scanClasses().values()];
const where = (c: UsedClass) => `${c.name} (used in ${[...c.files].join(', ')})`;

/* ------------------------------------------------------ literal colours */

/**
 * A literal colour: hex, a colour function, or the keywords the remap is
 * about. `var(…)` references are removed before testing, so
 * `text-[color:var(--color-muted)]` (a token, which dark mode does follow)
 * is not mistaken for the literal `white` in `--color-white`.
 */
const LITERAL_COLOUR = /#[0-9a-f]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black)(?![\w-])/i;
const withoutVars = (value: string) => value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '');

/**
 * An arbitrary value or property in a class (`bg-[#000]`, `[color:#fff]`,
 * `[&>details]:static`), variants and all. The lookbehind refuses `/` so the
 * opacity in `bg-black/[0.06]` (a palette class, checked above) is skipped.
 */
const ARBITRARY = /(?<![\w\-/:.\[\]])(?:[a-z0-9-]+:)*(?:[a-z][a-z0-9-]*-)?\[([^\]\s'"`]+)\](?![\w\-\[])/g;

/**
 * Black and white written as plain values in rendered code — an inline
 * style, an SVG fill or stroke, a colour constant. They are the same
 * fixed-opacity black/white the remap covers in classes, out of its reach.
 */
const NEUTRAL_LITERAL =
  /(['"`])\s*(?:white|black|#fff(?:fff)?|#000(?:000)?)\s*\1|\brgba?\(\s*(?:0\s*[,\s]\s*0\s*[,\s]\s*0|255\s*[,\s]\s*255\s*[,\s]\s*255)(?![\d.])/gi;

/**
 * Colours that are fixed on purpose, by file and literal as found, with why.
 * Each must still be present (a stale entry fails), so this list stays the
 * exact inventory of colours dark mode does not touch.
 */
const FIXED_COLOURS: Record<string, string> = {
  'components/doughnut/doughnut-renderer.js: "white"':
    'the doughnut canvas is a picture painted on its own white background (_setupCanvas), so its black/white strokes, fills and labels read the same on either page',
  'components/doughnut/doughnut-renderer.js: "black"': 'as above: drawn on the canvas’s own white background',
  'components/doughnut/Doughnut.tsx: rgba(0,0,0': 'the hover tooltip is a dark chip (and its drop shadow) in both themes',
  "components/doughnut/Doughnut.tsx: 'white'": 'the tooltip’s text, on its own dark chip',
};

function literalsIn(pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const { file, text } of SOURCES) {
    for (const m of text.matchAll(pattern)) found.add(`${file}: ${m[0]}`);
  }
  return [...found];
}

/* -------------------------------------------------------------- css parse */

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The brace-balanced block that opens at the first `{` at or after `from`, without its braces. */
function blockAt(css: string, from: number): string {
  const open = css.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after offset ${from}`);
}

function blockOf(css: string, header: string): string {
  const at = css.indexOf(header);
  if (at === -1) throw new Error(`missing block: ${header}`);
  return blockAt(css, at);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Custom properties declared in every `:root { @variant dark { … } }` block of a stylesheet. */
function darkVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  const clean = stripComments(css);
  let at = clean.indexOf(':root');
  while (at !== -1) {
    const body = blockAt(clean, at);
    if (body.trimStart().startsWith('@variant dark')) {
      for (const m of blockOf(body, '@variant dark').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        vars.set(m[1]!, m[2]!.trim());
      }
    }
    at = clean.indexOf(':root', at + 1);
  }
  return vars;
}

const TOKENS = darkVariables(GLOBALS);
const PALETTE = darkVariables(THEME_DARK);

function token(name: string): string {
  const v = TOKENS.get(`--color-${name}`);
  if (!v || !HEX.test(v)) throw new Error(`globals.css: dark --color-${name} must be a #rrggbb value, got ${v}`);
  return v;
}

/** The dark value of a colour as written in a class: black, white, or hue-shade. */
function darkColour(colour: string): string | undefined {
  if (colour === 'black' || colour === 'white') return token(colour);
  return PALETTE.get(`--color-${colour}`);
}

/* --------------------------------------------------------------- contrast */

type RGB = [number, number, number];
const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Alpha-composite `top` at `alpha` over an opaque `under`, as the browser paints it (sRGB). */
const over = (top: RGB, alpha: number, under: RGB): RGB =>
  top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as RGB;
const round = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ tests */

describe('dark theme coverage', () => {
  it('finds the classes it is guarding (the scan is not silently empty)', () => {
    expect(USED.some((c) => c.name === 'border-black/10')).toBe(true);
    expect(USED.some((c) => c.alpha === null && /-(?:50|100)$/.test(c.colour))).toBe(true);
    expect(PALETTE.size).toBeGreaterThan(0);
    // The whole tree Tailwind reads, not only app/ and components/.
    for (const file of ['middleware.ts', 'lib/theme.ts', 'components/theme/ThemeToggle.tsx']) {
      expect(SOURCES.map((s) => s.file)).toContain(file);
    }
    expect(SOURCES.some((s) => TEST_FILE.test(s.file) || s.file.startsWith('node_modules/'))).toBe(false);
  });

  it('scans what Tailwind compiles: globals.css leaves source detection automatic', () => {
    // With `source(…)` or `@source`, Tailwind would read a different set of
    // files than SOURCES; change the scan to match before changing this.
    expect(stripComments(GLOBALS)).toMatch(/@import\s+["']tailwindcss["']\s*;/);
    expect(stripComments(GLOBALS)).not.toMatch(/@source\b|source\(/);
  });

  it('writes no literal colour in an arbitrary class value (the remap cannot reach it)', () => {
    const literal: string[] = [];
    for (const { file, text } of SOURCES) {
      for (const m of text.matchAll(ARBITRARY)) {
        if (LITERAL_COLOUR.test(withoutVars(m[1]!))) literal.push(`${m[0]} (used in ${file})`);
      }
    }
    expect(literal, 'use a palette class (bg-black/10) or a token (bg-[color:var(--color-bg)])').toEqual([]);
  });

  it('writes no inline black/white literal outside FIXED_COLOURS', () => {
    const found = literalsIn(NEUTRAL_LITERAL);
    const allowed = (entry: string) => Object.keys(FIXED_COLOURS).some((fixed) => entry.startsWith(fixed));
    expect(
      found.filter((entry) => !allowed(entry)),
      'use a class the remap covers (bg-black/[0.06]) or a token (var(--color-bg)); a colour that must stay fixed goes in FIXED_COLOURS with its reason',
    ).toEqual([]);
    const stale = Object.keys(FIXED_COLOURS).filter((fixed) => !found.some((entry) => entry.startsWith(fixed)));
    expect(stale, 'remove FIXED_COLOURS entries that no longer match anything').toEqual([]);
  });

  it('the literal patterns catch what they are for (and leave tokens alone)', () => {
    const arbitrary = (text: string) => [...text.matchAll(ARBITRARY)].filter((m) => LITERAL_COLOUR.test(withoutVars(m[1]!))).map((m) => m[0]);
    expect(arbitrary('bg-[#000] hover:text-[rgb(0_0_0/0.5)] [color:white] border-[black]')).toEqual([
      'bg-[#000]',
      'hover:text-[rgb(0_0_0/0.5)]',
      '[color:white]',
      'border-[black]',
    ]);
    expect(arbitrary('text-[color:var(--color-white)] bg-black/[0.06] w-[18px] [&>:is(details,div)]:static')).toEqual([]);
    const neutral = (text: string) => [...text.matchAll(NEUTRAL_LITERAL)].map((m) => m[0]);
    expect(neutral(`fill="white" style={{ color: 'black', background: 'rgba(0,0,0,0.06)' }} rgb(255 255 255 / .5)`)).toEqual([
      '"white"',
      "'black'",
      'rgba(0,0,0',
      'rgb(255 255 255',
    ]);
    expect(neutral(`fill="var(--color-bg)" 'rgba(46,125,50,0.15)' bg-white 'whitespace'`)).toEqual([]);
  });

  it('globals.css imports theme-dark.css and defines every dark token', () => {
    expect(GLOBALS).toMatch(/@import\s+["']\.\/theme-dark\.css["']/);
    for (const name of ['bg', 'fg', 'muted', 'accent', 'white', 'black']) expect(() => token(name)).not.toThrow();
  });

  it('keeps `dark:` off colour utilities (the palette is already mirrored in dark mode)', () => {
    // `dark:bg-red-950` would read --color-red-950 *inside* dark mode, where
    // it holds the light tint: the opposite of what the author meant.
    const misused = USED.filter((c) => c.variants.includes('dark')).map(
      (c) => `${where(c)}: write the light-theme colour only; theme-dark.css supplies its dark value`,
    );
    expect(misused).toEqual([]);
  });

  it('gives every palette colour in use a dark value', () => {
    const missing = USED.filter((c) => c.colour !== 'black' && c.colour !== 'white')
      .filter((c) => !HEX.test(PALETTE.get(`--color-${c.colour}`) ?? ''))
      .map(where);
    expect(missing, 'add --color-<hue>-<shade> to the :root dark block in app/theme-dark.css').toEqual([]);
  });

  /** CSS property each utility sets, for the ones a remap can mirror one-to-one. */
  const PROPERTY: Record<string, string> = {
    bg: 'background-color',
    text: 'color',
    border: 'border-color',
    'border-x': 'border-inline-color',
    'border-y': 'border-block-color',
    'border-s': 'border-inline-start-color',
    'border-e': 'border-inline-end-color',
    'border-t': 'border-top-color',
    'border-r': 'border-right-color',
    'border-b': 'border-bottom-color',
    'border-l': 'border-left-color',
    outline: 'outline-color',
    fill: 'fill',
    stroke: 'stroke',
    decoration: 'text-decoration-color',
    caret: 'caret-color',
    accent: 'accent-color',
  };
  /** Variants whose Tailwind selector is the class plus one pseudo-class. */
  const PSEUDO_VARIANTS = new Set([
    'hover',
    'focus',
    'focus-within',
    'focus-visible',
    'active',
    'target',
    'visited',
    'disabled',
    'checked',
  ]);
  const escapeClass = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);

  it('remaps every opacity-modified colour for engines without color-mix(), to the colour modern engines compute', () => {
    const fallback = blockOf(stripComments(THEME_DARK), '@supports not (color: color-mix(in lab, red, red))');
    const problems: string[] = [];
    // `dark:` classes are rejected by the test above, not remapped.
    for (const c of USED.filter((u) => u.alpha !== null && !u.variants.includes('dark'))) {
      const property = PROPERTY[c.utility];
      const unsupported = c.variants.filter((v) => !PSEUDO_VARIANTS.has(v));
      if (!property || unsupported.length > 0) {
        problems.push(`${where(c)}: no remap pattern for this utility/variant — extend theme-dark.css and this test`);
        continue;
      }
      const selector = `.${escapeClass(c.name)}${c.variants.map((v) => `:${v}`).join('')}`;
      const at = fallback.search(new RegExp(`${selector.replace(/[\\.[\]()/]/g, '\\$&')}\\s*\\{`));
      if (at === -1) {
        problems.push(`${where(c)}: missing "${selector}" in the @supports not (…) block`);
        continue;
      }
      const decl = new RegExp(`(?<![\\w-])${property}\\s*:\\s*rgb\\((\\d+) (\\d+) (\\d+) / ([\\d.]+)\\)`).exec(blockAt(fallback, at));
      const base = darkColour(c.colour);
      if (!decl || !base) {
        problems.push(`${where(c)}: remap must set ${property}: rgb(r g b / a) under @variant dark`);
        continue;
      }
      const expected = [...rgbOf(base), c.alpha!];
      const actual = decl.slice(1, 5).map(Number);
      if (expected.some((v, i) => Math.abs(v - actual[i]!) > (i === 3 ? 0.001 : 0))) {
        problems.push(`${where(c)}: remap is rgb(${actual.join(' ')}) but the dark variables give rgb(${expected.join(' ')})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('applies nothing outside the dark variant (the light theme is unchanged)', () => {
    const css = stripComments(THEME_DARK);
    const stack: string[] = [];
    const outside: string[] = [];
    let buffer = '';
    const declaration = (text: string) => {
      const d = text.trim();
      if (!d || stack.some((h) => h.startsWith('@custom-variant'))) return;
      if (!stack.includes('@variant dark')) outside.push(`${stack.join(' > ')} { ${d} }`);
    };
    for (const ch of css) {
      if (ch === '{') {
        stack.push(buffer.trim());
        buffer = '';
      } else if (ch === '}') {
        declaration(buffer);
        stack.pop();
        buffer = '';
      } else if (ch === ';') {
        declaration(buffer);
        buffer = '';
      } else buffer += ch;
    }
    expect(outside).toEqual([]);
  });
});

describe('dark theme contrast (WCAG AA, 4.5:1)', () => {
  const bg = () => rgbOf(token('bg'));
  const surface = () => rgbOf(token('white')); // bg-white cards and menus
  const failures = (checks: [string, RGB, RGB][]) =>
    checks.filter(([, a, b]) => contrast(a, b) < AA).map(([label, a, b]) => `${label}: ${round(contrast(a, b))}:1`);

  it('page text, muted text and links read on the page and on raised surfaces', () => {
    const checks: [string, RGB, RGB][] = [];
    for (const name of ['fg', 'muted', 'accent']) {
      checks.push([`${name} on bg`, rgbOf(token(name)), bg()]);
      checks.push([`${name} on surface`, rgbOf(token(name)), surface()]);
    }
    // text-white is dark ink in dark mode; its fills (bg-black, the accent) turn light.
    checks.push(['text-white on bg-black', surface(), rgbOf(token('black'))]);
    checks.push(['text-white on accent', surface(), rgbOf(token('accent'))]);
    expect(failures(checks)).toEqual([]);
  });

  /**
   * Palette classes that have a dark value. A missing value is reported once,
   * by the coverage test above, rather than as a crash in every check here.
   */
  const palette = (c: UsedClass) =>
    c.colour === 'black' || c.colour === 'white' || !darkColour(c.colour) ? null : c.colour;
  const shadeOf = (colour: string) => Number(colour.split('-').pop());
  const tints = USED.filter((c) => c.utility === 'bg' && palette(c) && shadeOf(c.colour) <= 200);

  it('palette text reads on the page, on surfaces, and on its own hue’s tints', () => {
    const checks: [string, RGB, RGB][] = [];
    for (const c of USED.filter((u) => u.utility === 'text' && palette(u))) {
      const text = rgbOf(darkColour(c.colour)!);
      checks.push([`${where(c)} on bg`, text, bg()]);
      checks.push([`${where(c)} on surface`, text, surface()]);
      const hue = c.colour.replace(/-\d+$/, '');
      for (const t of tints.filter((t) => t.colour.startsWith(`${hue}-`))) {
        const fill = over(rgbOf(darkColour(t.colour)!), t.alpha ?? 1, bg());
        checks.push([`${c.name} on ${t.name}`, text, fill]);
      }
    }
    expect(failures(checks)).toEqual([]);
  });

  it('muted text reads on every tint in use (notices carry secondary text)', () => {
    const checks: [string, RGB, RGB][] = tints.map((t) => [
      `muted on ${where(t)}`,
      rgbOf(token('muted')),
      over(rgbOf(darkColour(t.colour)!), t.alpha ?? 1, bg()),
    ]);
    expect(failures(checks)).toEqual([]);
  });

  it('text-white reads on every solid palette fill in use', () => {
    const fills = USED.filter((c) => c.utility === 'bg' && palette(c) && shadeOf(c.colour) >= 500 && c.alpha === null);
    const checks: [string, RGB, RGB][] = fills.map((f) => [`text-white on ${where(f)}`, surface(), rgbOf(darkColour(f.colour)!)]);
    expect(failures(checks)).toEqual([]);
  });

  it('translucent black text meant to be read (50 % and up) reads on the page and on surfaces', () => {
    const checks: [string, RGB, RGB][] = [];
    for (const c of USED.filter((u) => u.utility === 'text' && u.colour === 'black' && (u.alpha ?? 1) >= 0.5)) {
      const ink = rgbOf(token('black'));
      const alpha = c.alpha ?? 1;
      checks.push([`${where(c)} on bg`, over(ink, alpha, bg()), bg()]);
      checks.push([`${where(c)} on surface`, over(ink, alpha, surface()), surface()]);
    }
    expect(failures(checks)).toEqual([]);
  });
});
