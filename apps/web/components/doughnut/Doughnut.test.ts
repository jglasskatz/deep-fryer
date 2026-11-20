import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flipTheme } from '@/components/theme/theme-dom';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { en } from '@/lib/i18n/messages/en';
import { escapeUnfries } from '@/lib/theme';
import {
  Doughnut,
  dismissesTooltip,
  doughnutKeyShortcuts,
  doughnutPixelRatio,
  doughnutShortcut,
  type ShortcutKeyEvent,
} from './Doughnut';
import { runShortcut, shortcutsDescription, type PortraitShortcuts } from './PortraitDoughnut';

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const dim = (slug: string, ring: 'social' | 'ecological') => ({ slug, ring, name: slug, viz_level: 0 });

describe('Doughnut', () => {
  it('server-renders a square canvas, so nothing below it moves when the renderer takes over', () => {
    // Without width/height a canvas lays out at 300×150 until the client sizes it.
    const html = renderToStaticMarkup(
      createElement(Doughnut, {
        social: [dim('food', 'social')],
        ecological: [dim('climate-change', 'ecological')],
        size: 720,
        labels: doughnutLabels(en),
      }),
    );
    const canvas = /<canvas[^>]*>/.exec(html)?.[0] ?? '';
    expect(canvas).toContain('width="720"');
    expect(canvas).toContain('height="720"');
  });

  it('draws at the screen density, capped at 3, never below 1', () => {
    expect(doughnutPixelRatio(1)).toBe(1);
    expect(doughnutPixelRatio(2.625)).toBe(2.625);
    expect(doughnutPixelRatio(4)).toBe(3);
    expect(doughnutPixelRatio(0.5)).toBe(1);
    expect(doughnutPixelRatio(undefined)).toBe(1);
    expect(doughnutPixelRatio(Number.NaN)).toBe(1);
  });

  it('hides its hover tooltip on an Escape nothing else used, and that Escape does not also un-fry the page', () => {
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: false })).toBe(true);
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: false, isComposing: true })).toBe(false);
    expect(dismissesTooltip({ key: 'Enter', defaultPrevented: false })).toBe(false);
    // The component calls preventDefault on the Escape it uses; DeepFryLayer then leaves it.
    expect(escapeUnfries({ key: 'Escape', defaultPrevented: true, target: null })).toBe(false);
  });
});

/**
 * The doughnut's shortcut keys, after the Santa Cruz site's: "d" switches
 * light and dark, 1–3 open the family's portraits. Single-character keys may
 * act only while their component has focus (WCAG 2.1.4): the canvas listens
 * for them itself, and doughnutShortcut refuses any key not pressed on it.
 */
describe('doughnut shortcuts', () => {
  const canvas = { tagName: 'CANVAS' };
  const textField = { tagName: 'INPUT', type: 'text' };
  const key = (k: string, over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: canvas,
    currentTarget: canvas,
    ...over,
  });

  const SHORTCUTS: PortraitShortcuts = {
    portraits: [
      { slug: 'city-santa-cruz', name: 'City of Santa Cruz', href: '/city-santa-cruz' },
      { slug: 'santa-cruz-county', name: 'Santa Cruz County', href: '/santa-cruz-county' },
      { slug: 'watsonville', name: 'Watsonville', href: '/watsonville' },
    ],
    current: 'city-santa-cruz',
    locale: 'en',
    labels: {
      theme: en.doughnut.shortcutsTheme,
      portraits: en.doughnut.shortcutsPortraits,
      portrait: en.doughnut.shortcutsPortrait,
      toggle: en.theme.toggle,
      light: en.theme.light,
      dark: en.theme.dark,
    },
  };

  /** Just enough of `document` for theme-dom: <html>'s attributes and a <head> for the theme-color meta. */
  function stubDocument() {
    const attributes = new Map<string, string>();
    const head: unknown[] = [];
    const doc = {
      documentElement: {
        getAttribute: (n: string) => attributes.get(n) ?? null,
        hasAttribute: (n: string) => attributes.has(n),
        setAttribute: (n: string, v: string) => void attributes.set(n, v),
        removeAttribute: (n: string) => void attributes.delete(n),
      },
      head: {
        get firstChild() {
          return head[0] ?? null;
        },
        insertBefore(node: unknown) {
          head.unshift(node);
          return node;
        },
        querySelector: () => null,
      },
      createElement: () => ({ name: '', content: '', setAttribute() {}, remove() {} }),
    };
    vi.stubGlobal('document', doc);
    return attributes;
  }
  afterEach(() => {
    vi.stubGlobal('document', undefined);
  });

  it('"d" typed in a text field does nothing; with the doughnut focused it changes the theme', () => {
    const html = stubDocument();
    html.set('data-theme', 'light');
    const open = vi.fn();

    // A "d" typed in a search box or a comment: not the doughnut's key.
    const typed = key('d', { target: textField, currentTarget: canvas });
    expect(doughnutShortcut(typed, 3)).toBeNull();
    expect(doughnutShortcut(key('d', { target: textField, currentTarget: textField }), 3)).toBeNull();
    expect(html.get('data-theme')).toBe('light');

    // The same key on the focused doughnut flips the theme, and says so.
    const shortcut = doughnutShortcut(key('d'), 3);
    expect(shortcut).toEqual({ kind: 'theme' });
    expect(runShortcut(shortcut!, SHORTCUTS, { flipTheme, open })).toBe('Theme: Dark');
    expect(html.get('data-theme')).toBe('dark');
    // And back again; Caps Lock does not turn the key off.
    expect(runShortcut(doughnutShortcut(key('D', {}), 3)!, SHORTCUTS, { flipTheme, open })).toBe('Theme: Light');
    expect(html.get('data-theme')).toBe('light');
    expect(open).not.toHaveBeenCalled();
  });

  it('number keys open the family’s portraits in the family bar’s order, and the current one’s key does nothing', () => {
    const open = vi.fn();
    const flip = vi.fn(() => 'dark' as const);
    expect(doughnutShortcut(key('2'), 3)).toEqual({ kind: 'portrait', index: 1 });
    runShortcut({ kind: 'portrait', index: 1 }, SHORTCUTS, { flipTheme: flip, open });
    expect(open).toHaveBeenCalledWith('/santa-cruz-county');
    runShortcut({ kind: 'portrait', index: 0 }, SHORTCUTS, { flipTheme: flip, open });
    expect(open).toHaveBeenCalledTimes(1);
    // Past the family, 0, and on a portrait that stands alone: nothing.
    expect(doughnutShortcut(key('4'), 3)).toBeNull();
    expect(doughnutShortcut(key('0'), 3)).toBeNull();
    expect(doughnutShortcut(key('1'), 0)).toBeNull();
    expect(flip).not.toHaveBeenCalled();
  });

  it('leaves keys with Ctrl, Alt or Cmd, held-down repeats, composition and spent keys alone', () => {
    expect(doughnutShortcut(key('d', { metaKey: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('d', { ctrlKey: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('1', { altKey: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('d', { repeat: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('d', { isComposing: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('d', { defaultPrevented: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('x'), 3)).toBeNull();
  });

  it('works on the same physical keys when the layout types another script or other digits there', () => {
    // Russian, Arabic and Korean layouts type these on the key marked D.
    for (const typed of ['в', 'В', 'ي', 'ㅇ']) {
      expect(doughnutShortcut(key(typed, { code: 'KeyD' }), 3)).toEqual({ kind: 'theme' });
    }
    // Arabic-Indic and Bengali digits, and French AZERTY's unshifted number row.
    expect(doughnutShortcut(key('٢', { code: 'Digit2' }), 3)).toEqual({ kind: 'portrait', index: 1 });
    expect(doughnutShortcut(key('২', { code: 'Digit2' }), 3)).toEqual({ kind: 'portrait', index: 1 });
    expect(doughnutShortcut(key('&', { code: 'Digit1' }), 3)).toEqual({ kind: 'portrait', index: 0 });
    expect(doughnutShortcut(key('۹', { code: 'Digit9' }), 3)).toBeNull();
    // Another script's other letters do nothing.
    expect(doughnutShortcut(key('ф', { code: 'KeyA' }), 3)).toBeNull();
    // A Latin letter is taken as typed: on Dvorak the key where QWERTY has D types "e".
    expect(doughnutShortcut(key('e', { code: 'KeyD' }), 3)).toBeNull();
    expect(doughnutShortcut(key('d', { code: 'KeyH' }), 3)).toEqual({ kind: 'theme' });
    // The same refusals hold on these layouts.
    expect(doughnutShortcut(key('в', { code: 'KeyD', isComposing: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('в', { code: 'KeyD', repeat: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('в', { code: 'KeyD', ctrlKey: true }), 3)).toBeNull();
    expect(doughnutShortcut(key('в', { code: 'KeyD', target: textField }), 3)).toBeNull();
    expect(doughnutShortcut(key('Dead', { code: 'KeyD' }), 3)).toBeNull();
  });

  it('makes the canvas focusable and names its keys only where the page turns them on', () => {
    const description = shortcutsDescription(SHORTCUTS);
    expect(description).toBe(
      'Press D to switch between light and dark. Press a number to open another portrait: 2 for Santa Cruz County and 3 for Watsonville.',
    );
    const withKeys = renderToStaticMarkup(
      createElement(Doughnut, {
        social: [dim('food', 'social')],
        ecological: [dim('climate-change', 'ecological')],
        labels: doughnutLabels(en),
        shortcuts: { portraitCount: 3, currentIndex: 0, description, onShortcut: () => undefined },
      }),
    );
    const canvasTag = /<canvas[^>]*>/.exec(withKeys)?.[0] ?? '';
    expect(canvasTag).toContain('tabindex="0"');
    // The current portrait's own number is left out, as in the description.
    expect(canvasTag).toContain('aria-keyshortcuts="D 2 3"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(canvasTag)?.[1];
    expect(withKeys).toContain(`id="${describedBy}" hidden="">${description}</span>`);

    // Embeds and the family comparison: a picture outside the tab order, as before.
    const without = renderToStaticMarkup(
      createElement(Doughnut, { social: [dim('food', 'social')], ecological: [], labels: doughnutLabels(en) }),
    );
    expect(without).not.toContain('tabindex');
    expect(without).not.toContain('aria-keyshortcuts');
    expect(doughnutKeyShortcuts(0)).toBe('D');
    expect(doughnutKeyShortcuts(12)).toBe('D 1 2 3 4 5 6 7 8 9');
    expect(doughnutKeyShortcuts(12, 4)).toBe('D 1 2 3 4 6 7 8 9');
    expect(doughnutKeyShortcuts(3, 2)).toBe('D 1 2');
  });

  it('a portrait that stands alone describes only the theme key', () => {
    expect(shortcutsDescription({ ...SHORTCUTS, portraits: [] })).toBe(en.doughnut.shortcutsTheme);
  });

  it('a portrait missing from its own family list describes only the theme key, as only that key acts', () => {
    expect(shortcutsDescription({ ...SHORTCUTS, current: 'elsewhere' })).toBe(en.doughnut.shortcutsTheme);
  });

  it('joins the portraits in the reader’s language, and with commas alone where there is no list data', () => {
    const four = {
      ...SHORTCUTS,
      portraits: [...SHORTCUTS.portraits, { slug: 'capitola', name: 'Capitola', href: '/capitola' }],
    };
    const listOnly = { ...four.labels, theme: 'D.', portraits: '{list}' };
    expect(shortcutsDescription({ ...four, locale: 'es', labels: listOnly })).toBe(
      'D. 2 for Santa Cruz County, 3 for Watsonville y 4 for Capitola',
    );
    // Haitian Creole: no English "and" inside a Haitian sentence.
    expect(shortcutsDescription({ ...four, locale: 'ht', labels: listOnly })).toBe(
      'D. 2 for Santa Cruz County, 3 for Watsonville, 4 for Capitola',
    );
  });
});
