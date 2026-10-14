/**
 * Theme preference and the deep-fry easter egg (SPEC-v5 §4) — the pure half.
 *
 * Three preferences: `light`, `dark`, and `system` (the default, which
 * follows the device's prefers-color-scheme). The choice is remembered per
 * device in localStorage under THEME_STORAGE_KEY and applied to
 * `<html data-theme="light|dark">` before first paint by THEME_INIT_SCRIPT
 * (app/layout.tsx). `system` leaves the attribute unset, so the CSS media
 * query decides (app/globals.css, the `dark` variant).
 *
 * Storage is an optional nicety: Safari private windows, blocked cookies
 * and some embedded browsers throw on `window.localStorage` itself, not only
 * on its methods. Every access here is wrapped, and a failure means the
 * reader gets the device's appearance — never an error.
 *
 * This module has no 'use client' or 'server-only': the root layout (server)
 * reads the init script, and the header toggle (client) uses the helpers.
 */

export const THEME_STORAGE_KEY = 'df-theme';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
/** What the page actually looks like once `system` is resolved. */
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The device's dark-mode media query, shared with the CSS `dark` variant. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * The browser's own chrome per resolved theme: the address bar on Android,
 * the tab bar in Safari, the title bar of the installed app. app/layout.tsx
 * declares both with media queries (they follow the device); an explicit
 * choice pins one of them through a single extra <meta> (see
 * applyThemeColorMeta), so the chrome matches the page, not the device.
 */
export const THEME_CHROME_COLORS: Record<ResolvedTheme, string> = { light: '#2f7d32', dark: '#1f5a22' };

/** Marks the one `<meta name="theme-color">` this module owns, to find and replace it. */
export const THEME_COLOR_META_ATTR = 'data-df-theme-color';

/** Anything that is not exactly an explicit choice means "follow the device". */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * The short click on the header toggle: flip what the reader currently sees.
 * `system` resolves to the device's appearance first, so a reader on a dark
 * phone who taps once gets light — never a click that appears to do nothing.
 * The result is always an explicit choice; returning to `system` is a menu
 * item ("Match device").
 */
export function toggledTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return resolveTheme(preference, systemPrefersDark) === 'dark' ? 'light' : 'dark';
}

/** The `data-theme` value for `<html>`; null (attribute removed) for `system`. */
export function themeAttribute(preference: ThemePreference): ResolvedTheme | null {
  return preference === 'system' ? null : preference;
}

/** The reader's remembered choice; `system` when nothing usable is stored or storage is blocked. */
export function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Remember the choice. `system` clears the key rather than storing it, so the
 * default can change later without a stale value pinning old readers.
 * Returns false when storage is unavailable (the choice then lasts until the
 * page is reloaded — the attribute is still applied for this visit).
 */
export function storePreference(preference: ThemePreference): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

/** The slice of `document` that applyThemeColorMeta touches (a structural type, so tests can pass a stub). */
export interface ThemeColorDocument {
  head: { firstChild: unknown; insertBefore(node: unknown, before: unknown): unknown; querySelector(selector: string): unknown };
  createElement(tag: 'meta'): { name: string; content: string; setAttribute(name: string, value: string): void };
}

/**
 * Keep the browser chrome on the reader's explicit choice. The HTML rule is
 * that the first `<meta name="theme-color">` in tree order whose media
 * matches wins, so the pinned one goes first in <head>, ahead of the
 * device-following pair Next renders from app/layout.tsx; "Match device"
 * removes it and that pair applies again. React leaves it alone: it is not
 * part of the rendered tree, and React 19 skips unknown <head> nodes when
 * hydrating. THEME_INIT_SCRIPT does the same before first paint.
 */
export function applyThemeColorMeta(doc: ThemeColorDocument, preference: ThemePreference): void {
  const existing = doc.head.querySelector(`meta[${THEME_COLOR_META_ATTR}]`) as
    | (ReturnType<ThemeColorDocument['createElement']> & { remove(): void })
    | null;
  const resolved = themeAttribute(preference);
  if (!resolved) {
    existing?.remove();
    return;
  }
  const meta = existing ?? doc.createElement('meta');
  meta.name = 'theme-color';
  meta.content = THEME_CHROME_COLORS[resolved];
  meta.setAttribute(THEME_COLOR_META_ATTR, '');
  if (doc.head.firstChild !== meta) doc.head.insertBefore(meta, doc.head.firstChild);
}

/**
 * Runs in <head> before the body is parsed (app/layout.tsx), carrying the
 * request's CSP nonce. Deliberately small and dependency-free: it reads the
 * stored choice and, only for an explicit light or dark, sets `data-theme`
 * (so the first paint already has the right colours) and pins the browser
 * chrome colour the way applyThemeColorMeta does. Everything, including the
 * `window.localStorage` property read, is inside one try: with storage
 * blocked the page simply follows the device. Tested by evaluating it with
 * stubbed globals (theme.test.ts), including that it pins the same <meta>
 * applyThemeColorMeta would.
 */
export const THEME_INIT_SCRIPT =
  '(function(){try{' +
  `var p=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  // data-theme first: the page's colours matter more than the chrome's.
  'if(p==="light"||p==="dark"){var d=document;d.documentElement.setAttribute("data-theme",p);' +
  'var h=d.head,m=d.createElement("meta");' +
  `m.name="theme-color";m.content=p==="dark"?${JSON.stringify(THEME_CHROME_COLORS.dark)}:${JSON.stringify(THEME_CHROME_COLORS.light)};` +
  `m.setAttribute(${JSON.stringify(THEME_COLOR_META_ATTR)},"");h.insertBefore(m,h.firstChild)}` +
  '}catch(e){}})();';

/* ------------------------------------------------------------------------ */
/* The toggle's gesture and menu logic, kept pure so it is unit-testable.   */
/* ------------------------------------------------------------------------ */

/** How long the pointer must stay down on the toggle to open the menu (SPEC-v5 §4: about 0.6 s). */
export const HOLD_TO_OPEN_MS = 600;

/** Movement beyond this (CSS px) means the reader is scrolling or dragging, not holding. */
export const HOLD_MOVE_TOLERANCE_PX = 10;

/** True when a pointer that went down at (x0, y0) has moved too far to count as a hold. */
export function holdCancelledByMove(x0: number, y0: number, x: number, y: number): boolean {
  return Math.hypot(x - x0, y - y0) > HOLD_MOVE_TOLERANCE_PX;
}

/** The keys that activate a focused button: Enter (on keydown) and Space (on keyup). */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

/**
 * What releasing a key means to a KeyHold: `press` — a short press, so
 * activate the toggle; `held` — the release of a press that already opened
 * the menu, to be swallowed; null — not a press this KeyHold is tracking.
 */
export type KeyRelease = 'press' | 'held' | null;

export interface KeyHold {
  /**
   * A keydown on the toggle. Returns true for Enter and Space, which the
   * toggle handles itself: the caller must preventDefault so the browser does
   * not also click. Auto-repeat keydowns (`repeat`) are swallowed and never
   * start, restart or fire anything; a fresh keydown starts a new press
   * (any earlier one ended without its keyup reaching us). `onHold` runs once
   * if the key is still down after the hold delay.
   */
  down(key: string, repeat: boolean, onHold: () => void): boolean;
  /** A keyup inside the control (the toggle, or the menu the hold opened). The caller preventDefaults any non-null result. */
  up(key: string): KeyRelease;
  /** The toggle lost focus mid-press: a short press is dropped (no toggle). A completed hold is kept, so its release is still swallowed. */
  abandon(): void;
  /** Unmount: stop any pending timer. */
  dispose(): void;
}

/**
 * Press-and-hold for the keyboard, the counterpart of the pointer hold
 * (SPEC-v5 §4; the toggle's description tells readers to "press and hold").
 *
 * Why the toggle does not let the browser click on Enter: a <button>
 * activates on every Enter keydown, auto-repeat included, so a held Enter
 * flipped the whole page between light and dark 11–30 times a second —
 * a general flash (WCAG 2.3.1), and exactly what the "press and hold"
 * instruction invites. Instead a short press (released before the hold
 * delay) activates once on release, and a hold opens the menu without
 * flipping anything, as a pointer hold does. Measured on timers rather than
 * on key repeat, so it also works for readers who turned key repeat off.
 */
export function createKeyHold(delayMs: number = HOLD_TO_OPEN_MS): KeyHold {
  let press: { key: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  const stop = () => {
    if (press?.timer) clearTimeout(press.timer);
  };
  return {
    down(key, repeat, onHold) {
      if (!isActivationKey(key)) return false;
      if (repeat) return true;
      stop();
      const current: { key: string; timer: ReturnType<typeof setTimeout> | null } = { key, timer: null };
      current.timer = setTimeout(() => {
        current.timer = null;
        onHold();
      }, delayMs);
      press = current;
      return true;
    },
    up(key) {
      if (!press || press.key !== key) return null;
      const short = press.timer !== null;
      stop();
      press = null;
      return short ? 'press' : 'held';
    },
    abandon() {
      if (press?.timer) {
        clearTimeout(press.timer);
        press = null;
      }
    },
    dispose() {
      stop();
      press = null;
    },
  };
}

/**
 * Activations of the toggle closer together than this form one burst, and
 * only the first of a burst flips the theme. The keyboard path above never
 * produces bursts, but other inputs can: a screen reader in browse mode
 * turns a held Enter into repeated synthetic clicks (no key events reach
 * the page), and switch or voice control can repeat a command. Each ignored
 * click extends the burst, so however long they repeat, the page flips once.
 * A habitual double-click also flips once instead of flipping back.
 */
export const ACTIVATION_BURST_MS = 500;

/** Returns a filter: call it with the time of each activation; true means act on it. */
export function createBurstFilter(windowMs: number = ACTIVATION_BURST_MS): (now: number) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return (now) => {
    const first = now - last >= windowMs;
    last = now;
    return first;
  };
}

/**
 * Elements that own Escape themselves: text entry (Escape clears a search
 * field or cancels an edit) and dialogs (Escape closes them, often without
 * calling preventDefault). Inputs that take no text, such as checkboxes and
 * buttons, do not, so Escape still un-fries from them. Chained :not() rather
 * than a selector list, for the older engines the app supports.
 */
const ESCAPE_OWNERS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="range"]):not([type="color"]):not([type="file"]),' +
  'textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,[role="dialog"],[role="alertdialog"]';

/** The parts of a keydown event escapeUnfries reads. */
export interface EscapeKeyEvent {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  keyCode?: number;
  target: unknown;
}

/**
 * Whether a keydown should un-fry the page (DeepFryLayer). Only an Escape
 * nothing else used: not one a widget already handled (the theme menu
 * closing itself calls preventDefault), not one that cancels an IME
 * composition (Chinese and Korean readers press Escape to drop a half-typed
 * syllable; browsers report keyCode 229 for keys the IME takes), and not
 * one pressed inside a field or dialog that owns Escape.
 */
export function escapeUnfries(event: EscapeKeyEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return !(target && typeof target.closest === 'function' && target.closest(ESCAPE_OWNERS));
}

/**
 * Keys that open the theme menu from the focused toggle: Shift+F10 and the
 * ContextMenu ("Menu") key are the platform's keyboard equivalents of a
 * right-click; ArrowDown is the WAI-ARIA menu-button convention.
 */
export function opensThemeMenu(key: string, shiftKey: boolean): boolean {
  return key === 'ContextMenu' || (key === 'F10' && shiftKey) || key === 'ArrowDown';
}

/**
 * Roving focus inside the menu (WAI-ARIA menu pattern): arrows move and wrap,
 * Home/End jump. Returns the index to focus, or null for keys the menu does
 * not use for movement (Enter/Space/Escape/Tab are handled by the caller).
 */
export function menuFocusIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
