import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  applyThemeColorMeta,
  parseThemePreference,
  storePreference,
  themeAttribute,
  type ThemePreference,
} from '@/lib/theme';

/**
 * The theme's live state for client components (SPEC-v5 §4), with <html>
 * as the single source of truth:
 *
 * - `data-theme` is the preference: set before first paint by the init
 *   script (app/layout.tsx), absent for "Match device".
 * - `data-fried` is the deep-fry flag: per visit, never stored.
 * - one `<meta name="theme-color">` first in <head> pins the browser chrome
 *   to an explicit choice (lib/theme.ts applyThemeColorMeta); absent for
 *   "Match device", where the device-following pair from layout.tsx applies.
 *
 * Keeping the state on the element rather than in React means it survives
 * the header remounting on every client-side navigation (each page renders
 * its own SiteHeader), stays correct when storage is blocked (the choice
 * then lives only on the element for this visit), and lets a
 * MutationObserver keep every subscriber in step, whoever made the change.
 * Components read it through useSyncExternalStore.
 */

export interface ThemeState {
  preference: ThemePreference;
  fried: boolean;
}

/** What the server renders: it cannot see the reader's stored choice. */
const SERVER_STATE: ThemeState = Object.freeze({ preference: 'system', fried: false });

/** useSyncExternalStore requires the same object back while nothing changed. */
let cached: ThemeState = SERVER_STATE;

export function getThemeState(): ThemeState {
  const root = document.documentElement;
  const preference = parseThemePreference(root.getAttribute('data-theme'));
  const fried = root.hasAttribute('data-fried');
  if (cached.preference !== preference || cached.fried !== fried) cached = { preference, fried };
  return cached;
}

export function getServerThemeState(): ThemeState {
  return SERVER_STATE;
}

export function subscribeThemeState(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-fried'] });
  // Another tab changed the choice (or cleared site data: key null).
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) applyPreference(parseThemePreference(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

function applyPreference(preference: ThemePreference): void {
  const value = themeAttribute(preference);
  const root = document.documentElement;
  if (value) root.setAttribute('data-theme', value);
  else root.removeAttribute('data-theme');
  applyThemeColorMeta(document, preference);
}

/** Apply now and remember on this device (best effort: storage may be blocked). */
export function setThemePreference(preference: ThemePreference): void {
  applyPreference(preference);
  storePreference(preference);
}

export function setFried(fried: boolean): void {
  if (fried) document.documentElement.setAttribute('data-fried', '');
  else document.documentElement.removeAttribute('data-fried');
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    return false;
  }
}
