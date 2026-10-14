import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVATION_BURST_MS,
  HOLD_TO_OPEN_MS,
  THEME_CHROME_COLORS,
  THEME_COLOR_META_ATTR,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeColorMeta,
  createBurstFilter,
  createKeyHold,
  escapeUnfries,
  holdCancelledByMove,
  isActivationKey,
  menuFocusIndex,
  opensThemeMenu,
  parseThemePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  themeAttribute,
  toggledTheme,
  type ThemeColorDocument,
} from './theme';

/**
 * Just enough of `document` for the theme-color <meta>: a head whose
 * children are kept in order, and elements that record their attributes.
 */
function fakeDocument() {
  type FakeMeta = { name: string; content: string; attributes: Map<string, string>; setAttribute(n: string, v: string): void; remove(): void };
  const children: FakeMeta[] = [{ name: 'charset', content: '', attributes: new Map(), setAttribute() {}, remove() {} }];
  const rootAttributes = new Map<string, string>();
  const doc = {
    children,
    rootAttributes,
    documentElement: { setAttribute: (name: string, value: string) => void rootAttributes.set(name, value) },
    head: {
      get firstChild() {
        return children[0] ?? null;
      },
      insertBefore(node: FakeMeta, before: FakeMeta | null) {
        const from = children.indexOf(node);
        if (from !== -1) children.splice(from, 1);
        children.splice(before ? children.indexOf(before) : children.length, 0, node);
        return node;
      },
      querySelector(selector: string) {
        expect(selector).toBe(`meta[${THEME_COLOR_META_ATTR}]`);
        return children.find((c) => c.attributes.has(THEME_COLOR_META_ATTR)) ?? null;
      },
    },
    createElement(tag: string): FakeMeta {
      expect(tag).toBe('meta');
      const el: FakeMeta = {
        name: '',
        content: '',
        attributes: new Map(),
        setAttribute: (n, v) => void el.attributes.set(n, v),
        remove: () => void children.splice(children.indexOf(el), 1),
      };
      return el;
    },
    /** The pinned theme-colour, as the browser picks it: the first theme-color <meta>. */
    pinned() {
      const first = children.find((c) => c.name === 'theme-color');
      return first ? { content: first.content, first: children[0] === first, count: children.filter((c) => c.name === 'theme-color').length } : null;
    },
  };
  return doc;
}

describe('theme preference helpers', () => {
  it('parses only an explicit light or dark; everything else follows the device', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    for (const junk of ['system', 'DARK', '', null, undefined, 1, {}, ' dark']) {
      expect(parseThemePreference(junk)).toBe('system');
    }
  });

  it('resolves system against the device and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('a short click flips what the reader sees, resolving system first', () => {
    expect(toggledTheme('light', true)).toBe('dark');
    expect(toggledTheme('dark', false)).toBe('light');
    // On a dark device, "system" looks dark, so one tap means light.
    expect(toggledTheme('system', true)).toBe('light');
    expect(toggledTheme('system', false)).toBe('dark');
  });

  it('sets data-theme only for explicit choices', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('system')).toBeNull();
  });
});

describe('stored preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      data,
    };
  }

  it('round-trips explicit choices and clears the key for system', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(storePreference('dark')).toBe(true);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredPreference()).toBe('dark');
    expect(storePreference('system')).toBe(true);
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readStoredPreference()).toBe('system');
  });

  it('falls back to system when storage is blocked, missing, or holds junk', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(readStoredPreference()).toBe('system');
    expect(storePreference('dark')).toBe(false);

    vi.stubGlobal('localStorage', undefined);
    expect(readStoredPreference()).toBe('system');
    expect(storePreference('light')).toBe(false);

    vi.stubGlobal('localStorage', memoryStorage({ [THEME_STORAGE_KEY]: '<script>' }));
    expect(readStoredPreference()).toBe('system');
  });
});

describe('THEME_INIT_SCRIPT', () => {
  /**
   * Evaluate the script in a fresh V8 context whose only globals are the
   * stubs, the way the browser runs it in <head>: a reference to anything
   * else would fail here rather than silently in production.
   */
  function run(window: Record<string, unknown>) {
    const document = fakeDocument();
    runInNewContext(THEME_INIT_SCRIPT, { window, document });
    return document.rootAttributes;
  }

  const storageWith = (value: string | null) => ({ getItem: (k: string) => (k === THEME_STORAGE_KEY ? value : null) });

  it('applies an explicit stored choice before first paint', () => {
    expect(run({ localStorage: storageWith('dark') }).get('data-theme')).toBe('dark');
    expect(run({ localStorage: storageWith('light') }).get('data-theme')).toBe('light');
  });

  it('pins the browser chrome colour for an explicit choice, as applyThemeColorMeta does', () => {
    for (const choice of ['light', 'dark'] as const) {
      const viaScript = fakeDocument();
      runInNewContext(THEME_INIT_SCRIPT, { window: { localStorage: storageWith(choice) }, document: viaScript });
      const viaHelper = fakeDocument();
      applyThemeColorMeta(viaHelper as unknown as ThemeColorDocument, choice);
      expect(viaScript.pinned()).toEqual({ content: THEME_CHROME_COLORS[choice], first: true, count: 1 });
      expect(viaScript.pinned()).toEqual(viaHelper.pinned());
      expect(viaScript.children[0]!.attributes.has(THEME_COLOR_META_ATTR)).toBe(true);
    }
    const followDevice = fakeDocument();
    runInNewContext(THEME_INIT_SCRIPT, { window: { localStorage: storageWith(null) }, document: followDevice });
    expect(followDevice.pinned()).toBeNull();
  });

  it('leaves data-theme unset for system, nothing stored, or junk', () => {
    for (const value of ['system', null, '', 'dark; color: red', 'Dark']) {
      expect(run({ localStorage: storageWith(value) }).has('data-theme')).toBe(false);
    }
  });

  it('never throws when localStorage is unavailable', () => {
    // The property read itself throws (Safari private mode, blocked site data).
    const blocked = {};
    Object.defineProperty(blocked, 'localStorage', {
      get() {
        throw new Error('SecurityError: The operation is insecure.');
      },
    });
    expect(() => run(blocked)).not.toThrow();
    expect(run(blocked).size).toBe(0);
    // Present but every call throws.
    expect(() =>
      run({
        localStorage: {
          getItem() {
            throw new Error('denied');
          },
        },
      }),
    ).not.toThrow();
    // Absent entirely (old embedded browsers, some test harnesses).
    expect(() => run({})).not.toThrow();
    expect(() => run({ localStorage: null })).not.toThrow();
  });

  it('never throws even without a document element', () => {
    expect(() =>
      runInNewContext(THEME_INIT_SCRIPT, { window: { localStorage: storageWith('dark') }, document: {} }),
    ).not.toThrow();
  });

  it('is a single self-contained statement safe to inline in HTML', () => {
    // Nothing that could close the <script> element or open an HTML comment.
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/script|<!--/i);
    // It blocks parsing on every page: keep it small.
    expect(THEME_INIT_SCRIPT.length).toBeLessThan(600);
  });
});

describe('applyThemeColorMeta', () => {
  it('keeps exactly one pinned colour first in <head>, and removes it for system', () => {
    const doc = fakeDocument();
    const apply = (p: 'light' | 'dark' | 'system') => applyThemeColorMeta(doc as unknown as ThemeColorDocument, p);
    apply('dark');
    expect(doc.pinned()).toEqual({ content: THEME_CHROME_COLORS.dark, first: true, count: 1 });
    apply('light');
    expect(doc.pinned()).toEqual({ content: THEME_CHROME_COLORS.light, first: true, count: 1 });
    apply('system');
    expect(doc.pinned()).toBeNull();
    expect(doc.children).toHaveLength(1); // only the original head child is left
  });
});

describe('keyboard press-and-hold (createKeyHold)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Drive a KeyHold the way the browser drives the toggle while a key is
   * held: one keydown, then (after the OS repeat delay) auto-repeat keydowns
   * with `repeat: true`, then the keyup. Counts what the toggle would do:
   * `presses` flip the theme, `holds` open the menu, and every keydown the
   * KeyHold claims is one the toggle preventDefaults — so the browser's own
   * click, which it fires on each non-prevented Enter keydown, never runs.
   */
  function holdKey(key: string, heldMs: number, { repeatDelayMs = 500, repeatEveryMs = 33 } = {}) {
    const hold = createKeyHold();
    let holds = 0;
    let browserClicks = 0;
    const keydown = (repeat: boolean) => {
      const claimed = hold.down(key, repeat, () => holds++);
      if (!claimed && key === 'Enter') browserClicks++;
    };
    let elapsed = 0;
    const wait = (ms: number) => {
      vi.advanceTimersByTime(ms);
      elapsed += ms;
    };
    keydown(false);
    if (repeatDelayMs < heldMs) {
      wait(repeatDelayMs);
      keydown(true);
      while (elapsed + repeatEveryMs < heldMs) {
        wait(repeatEveryMs);
        keydown(true);
      }
    }
    wait(heldMs - elapsed);
    const release = hold.up(key);
    return { holds, browserClicks, presses: release === 'press' ? 1 : 0, release };
  }

  it('a held Enter never flips the page: it opens the menu once and the browser never clicks', () => {
    // 3 s of auto-repeat at 30/s used to be ~75 full-page flips (WCAG 2.3.1).
    expect(holdKey('Enter', 3000)).toEqual({ holds: 1, browserClicks: 0, presses: 0, release: 'held' });
    expect(holdKey(' ', 3000)).toEqual({ holds: 1, browserClicks: 0, presses: 0, release: 'held' });
    // Readers with key repeat turned off: no repeat keydowns, same result.
    expect(holdKey('Enter', 3000, { repeatDelayMs: Infinity })).toEqual({ holds: 1, browserClicks: 0, presses: 0, release: 'held' });
  });

  it('a quick press flips once, on release', () => {
    expect(holdKey('Enter', 120)).toEqual({ holds: 0, browserClicks: 0, presses: 1, release: 'press' });
    expect(holdKey(' ', HOLD_TO_OPEN_MS - 1)).toEqual({ holds: 0, browserClicks: 0, presses: 1, release: 'press' });
  });

  it('claims only Enter and Space; other keys keep their own handling', () => {
    const hold = createKeyHold();
    for (const key of ['ArrowDown', 'F10', 'ContextMenu', 'Escape', 'Tab', 'a']) {
      expect(hold.down(key, false, () => {})).toBe(false);
      expect(hold.up(key)).toBeNull();
    }
    expect(isActivationKey('Enter') && isActivationKey(' ')).toBe(true);
  });

  it('drops a short press when focus leaves, but still swallows the release of a completed hold', () => {
    const hold = createKeyHold();
    const onHold = vi.fn();
    hold.down('Enter', false, onHold);
    hold.abandon();
    vi.advanceTimersByTime(HOLD_TO_OPEN_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
    expect(hold.up('Enter')).toBeNull();

    hold.down('Enter', false, onHold);
    vi.advanceTimersByTime(HOLD_TO_OPEN_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
    hold.abandon(); // focus moved into the menu the hold opened
    expect(hold.up('Enter')).toBe('held'); // the release on the menu item is swallowed
  });

  it('a fresh keydown starts a new press even if the last keyup never arrived', () => {
    const hold = createKeyHold();
    const onHold = vi.fn();
    hold.down('Enter', false, onHold);
    vi.advanceTimersByTime(HOLD_TO_OPEN_MS);
    // The keyup went elsewhere (focus moved by a click). Next press:
    hold.down('Enter', false, onHold);
    expect(hold.up('Enter')).toBe('press');
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('dispose stops a pending hold', () => {
    const hold = createKeyHold();
    const onHold = vi.fn();
    hold.down(' ', false, onHold);
    hold.dispose();
    vi.advanceTimersByTime(HOLD_TO_OPEN_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });
});

describe('createBurstFilter', () => {
  it('acts on the first of a burst only, however long the burst runs', () => {
    const first = createBurstFilter();
    // A screen reader repeating its click 30 times a second for 3 s.
    const acted = Array.from({ length: 90 }, (_, i) => first(1000 + i * 33)).filter(Boolean);
    expect(acted).toHaveLength(1);
    // A pause as long as the window ends the burst.
    expect(first(1000 + 89 * 33 + ACTIVATION_BURST_MS)).toBe(true);
  });

  it('lets deliberate presses through and folds a double-click into one', () => {
    const first = createBurstFilter();
    expect([0, 700, 1400].map(first)).toEqual([true, true, true]);
    const second = createBurstFilter();
    expect([0, 180].map(second)).toEqual([true, false]);
  });
});

describe('escapeUnfries', () => {
  const on = (matches: string[]) => ({
    closest: (selector: string) => (matches.some((m) => selector.split(',').includes(m)) ? {} : null),
  });
  const escape = (extra: Partial<Parameters<typeof escapeUnfries>[0]> = {}) =>
    escapeUnfries({ key: 'Escape', defaultPrevented: false, target: on([]), ...extra });

  it('un-fries on a plain Escape, from the page or a non-text control', () => {
    expect(escape()).toBe(true);
    expect(escape({ target: null })).toBe(true);
    expect(escape({ target: {} })).toBe(true); // window / document: no closest()
  });

  it('leaves Escape to whatever already used it', () => {
    expect(escape({ defaultPrevented: true })).toBe(false); // the theme menu closing itself
    expect(escape({ isComposing: true })).toBe(false); // cancelling an IME composition
    expect(escape({ keyCode: 229 })).toBe(false); // a key the IME took
    expect(escape({ target: on(['textarea']) })).toBe(false);
    expect(escape({ target: on(['select']) })).toBe(false);
    expect(escape({ target: on(['dialog']) })).toBe(false);
    expect(escape({ target: on(['[role="dialog"]']) })).toBe(false);
    expect(escape({ target: on(['[contenteditable]:not([contenteditable="false"])']) })).toBe(false);
    expect(escapeUnfries({ key: 'Enter', defaultPrevented: false, target: null })).toBe(false);
  });
});

describe('toggle gesture and menu keys', () => {
  it('cancels a hold only when the pointer travels beyond the tolerance', () => {
    expect(holdCancelledByMove(100, 100, 106, 106)).toBe(false); // ~8.5 px
    expect(holdCancelledByMove(100, 100, 100, 110)).toBe(false); // exactly 10 px
    expect(holdCancelledByMove(100, 100, 108, 108)).toBe(true); // ~11.3 px
  });

  it('opens the menu from Shift+F10, the Menu key, or ArrowDown — not plain F10', () => {
    expect(opensThemeMenu('F10', true)).toBe(true);
    expect(opensThemeMenu('ContextMenu', false)).toBe(true);
    expect(opensThemeMenu('ArrowDown', false)).toBe(true);
    expect(opensThemeMenu('F10', false)).toBe(false);
    expect(opensThemeMenu('Enter', false)).toBe(false);
  });

  it('moves focus with wrapping arrows and Home/End', () => {
    expect(menuFocusIndex('ArrowDown', 0, 4)).toBe(1);
    expect(menuFocusIndex('ArrowDown', 3, 4)).toBe(0);
    expect(menuFocusIndex('ArrowUp', 0, 4)).toBe(3);
    expect(menuFocusIndex('Home', 2, 4)).toBe(0);
    expect(menuFocusIndex('End', 0, 4)).toBe(3);
    expect(menuFocusIndex('Enter', 1, 4)).toBeNull();
    expect(menuFocusIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
