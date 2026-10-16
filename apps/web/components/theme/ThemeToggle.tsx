'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { fmt } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages';
import {
  HOLD_TO_OPEN_MS,
  createBurstFilter,
  createKeyHold,
  holdCancelledByMove,
  isActivationKey,
  menuFocusIndex,
  opensThemeMenu,
  toggledTheme,
  type ThemePreference,
} from '@/lib/theme';
import {
  getServerThemeState,
  getThemeState,
  setFried,
  setThemePreference,
  subscribeThemeState,
  systemPrefersDark,
} from './theme-dom';

export type ThemeLabels = Messages['theme'];

/** Menu order (SPEC-v5 §4): the three preferences, a separator, then the fryer. */
const PREFERENCES: ThemePreference[] = ['light', 'dark', 'system'];
const FRY_INDEX = PREFERENCES.length;
const ITEM_COUNT = PREFERENCES.length + 1;

/** How long the "Theme: Dark" announcement stays in the live region before it is cleared. */
const ANNOUNCEMENT_MS = 5000;

/**
 * The header's theme control (SPEC-v5 §4), from the owner's note "hold down
 * dark mode (or right click) and have option to deep fry the page".
 *
 * - A short click, tap, or quick Enter/Space flips light <-> dark ("Match
 *   device" resolves to what the device shows first, so the click always
 *   visibly does something), and a polite status message says which theme
 *   is now on — screen readers do not reliably re-read a focused button's
 *   changed name. Only the first activation of a burst flips (lib/theme.ts
 *   createBurstFilter), so no input repeated at any rate can flash the page.
 * - Press and hold (600 ms: a pointer that moves no more than 10 px, or
 *   Enter/Space held down — lib/theme.ts createKeyHold), right-click, or
 *   Shift+F10 / the Menu key / ArrowDown while focused opens a small menu:
 *   Light, Dark, Match device (radio items), then "Deep fry this page".
 *
 * Enter and Space do not open the menu as the WAI-ARIA menu-button pattern
 * would: the owner's design is a one-press toggle with the menu one gesture
 * further. aria-haspopup still tells screen readers a menu exists, and the
 * description (also the hover title) names every way to it, Shift+F10
 * among them (aria-keyshortcuts).
 *
 * The menu follows the WAI-ARIA menu pattern: focus moves into it (onto the
 * checked preference), arrows and Home/End move with wrapping, Enter/Space
 * activate (the items are buttons; auto-repeat never re-activates one),
 * Escape closes and returns focus to the toggle, Tab closes and continues
 * from the toggle, and a pointer press outside closes it. Positioned with
 * logical `end-0`, so it opens towards the page in right-to-left languages
 * too; on phones SiteHeader anchors it to the whole control group instead,
 * so it cannot run off the start edge.
 *
 * State lives on <html> (theme-dom.ts); the fry overlay, its announcement and
 * its Escape shortcut live in DeepFryLayer (root layout), so they keep
 * working on pages without this header. Labels arrive as props from the
 * server-rendered SiteHeader, in the request's language.
 */
export function ThemeToggle({
  labels,
  deepFry,
}: {
  labels: ThemeLabels;
  /**
   * Whether the deployment offers the deep fry (SPEC-v7 §3, `deep_fry`): off,
   * the menu is just the three themes and its keyboard wraps over those.
   */
  deepFry: boolean;
}) {
  const itemCount = deepFry ? ITEM_COUNT : PREFERENCES.length;
  const { preference, fried } = useSyncExternalStore(subscribeThemeState, getThemeState, getServerThemeState);
  const [open, setOpen] = useState(false);
  /** The menu item that holds focus (roving tabindex). */
  const [active, setActive] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  /**
   * Set when a hold or a context-menu gesture opened the menu: the click the
   * browser fires when that same press ends must not also toggle the theme.
   * Cleared by the next press or key on the toggle.
   */
  const swallowClick = useRef(false);
  /** Keyboard press-and-hold on Enter/Space (one per mounted toggle). */
  const [keyHold] = useState(createKeyHold);
  /** True for the first activation of a burst; see createBurstFilter. */
  const [firstOfBurst] = useState(() => createBurstFilter());
  /** The polite status text after a short-press flip ("Theme: Dark"); cleared after ANNOUNCEMENT_MS. */
  const [announcement, setAnnouncement] = useState('');
  const menuId = useId();
  const hintId = useId();

  const modeName: Record<ThemePreference, string> = {
    light: labels.light,
    dark: labels.dark,
    system: labels.system,
  };
  const hint = fmt(labels.hint, { system: labels.system });

  function cancelHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }
  // A pending hold must not open a menu after the header has unmounted.
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current.timer);
      keyHold.dispose();
    },
    [keyHold],
  );

  // Clear the status message once it has been read, so the region is empty
  // when idle (nothing stale for a browse-mode cursor to land on) and the
  // next flip is always a change a screen reader announces.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  function openMenu() {
    cancelHold();
    setAnnouncement('');
    setActive(PREFERENCES.indexOf(preference));
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Focus follows the active item while the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // A press anywhere outside the control closes the menu. pointerdown, not
  // click: the press that ends a hold is still in progress when the menu
  // opens, and its click lands on the toggle, inside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    swallowClick.current = false;
    // Secondary buttons arrive as contextmenu; a hold while open is just a click.
    if (event.button !== 0 || open) return;
    cancelHold();
    hold.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        swallowClick.current = true;
        openMenu();
      }, HOLD_TO_OPEN_MS),
    };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const h = hold.current;
    if (h && holdCancelledByMove(h.x, h.y, event.clientX, event.clientY)) cancelHold();
  }

  function onContextMenu(event: MouseEvent<HTMLButtonElement>) {
    // Right-click, the Menu key, and Android's long-press all arrive here.
    event.preventDefault();
    swallowClick.current = true;
    openMenu();
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    swallowClick.current = false;
    // Enter and Space are handled here rather than by the browser's click,
    // which would fire on every auto-repeated Enter: a quick press acts on
    // release (onButtonKeyUp), a held one opens the menu.
    if (keyHold.down(event.key, event.repeat, openMenu)) {
      event.preventDefault();
      return;
    }
    if (opensThemeMenu(event.key, event.shiftKey)) {
      event.preventDefault();
      openMenu();
    }
  }

  function onButtonKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    const release = keyHold.up(event.key);
    if (release === null) return;
    // Also stops engines that click buttons on the Space keyup itself.
    event.preventDefault();
    if (release === 'press') activate();
  }

  function onButtonClick() {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    activate();
  }

  /** A short click, tap or key press: close the open menu, or flip light <-> dark. */
  function activate() {
    if (open) {
      closeMenu(false);
      return;
    }
    if (!firstOfBurst(performance.now())) return;
    const next = toggledTheme(preference, systemPrefersDark());
    setThemePreference(next);
    setAnnouncement(fmt(labels.toggle, { mode: modeName[next] }));
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Auto-repeat never activates an item: a held Enter chooses once, instead
    // of choosing, landing back on the toggle and firing there.
    if (event.repeat && isActivationKey(event.key)) {
      event.preventDefault();
      return;
    }
    const next = menuFocusIndex(event.key, active, itemCount);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === 'Escape') {
      // preventDefault also tells DeepFryLayer this Escape was spent closing
      // the menu, so it does not un-fry the page as well.
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      // Move focus to the toggle first, then let the browser's own Tab move
      // on from there — forwards or backwards — as it would from the toggle.
      buttonRef.current?.focus();
      setOpen(false);
    }
  }

  // The Enter/Space whose hold opened the menu is released here (focus moved
  // into the menu when it opened); that release must not activate the item.
  function onMenuKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (keyHold.up(event.key) !== null) event.preventDefault();
  }

  // On Windows the Menu key's contextmenu event arrives on key release, by
  // which time focus is on a menu item: without this the browser's own
  // context menu (Back, Reload, …) would open over this one.
  function onMenuContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  // Focus moving to something outside the control (a screen reader's
  // virtual cursor, Shift+Tab past the menu) closes it too. A blur with no
  // new target is ignored: Safari sends one when a menu item is clicked,
  // because it does not focus buttons on click, and closing then would
  // swallow the click. Presses outside are handled above.
  function onWrapperBlur(event: FocusEvent<HTMLDivElement>) {
    const to = event.relatedTarget as Node | null;
    if (open && to && !wrapperRef.current?.contains(to)) setOpen(false);
  }

  function choose(next: ThemePreference) {
    setThemePreference(next);
    closeMenu(true);
  }

  function toggleFry() {
    setFried(!fried);
    closeMenu(true);
  }

  // The focused item is tinted (focus can arrive from a hold, where the
  // browser shows no focus ring); keyboard focus also gets the native ring.
  const itemClass = 'flex w-full items-center gap-2 rounded px-3 py-2 text-start hover:bg-black/5 focus:bg-black/5';

  return (
    <div ref={wrapperRef} className="relative" onBlur={onWrapperBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-describedby={hintId}
        aria-keyshortcuts="Shift+F10"
        // The same hint for sighted pointer users. With aria-describedby set,
        // the title is not used as the description too, so it is read once.
        title={hint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={onContextMenu}
        onKeyDown={onButtonKeyDown}
        onKeyUp={onButtonKeyUp}
        onBlur={() => keyHold.abandon()}
        onClick={onButtonClick}
        // No text selection or iOS callout while holding; panning still scrolls
        // (and cancels the hold through pointercancel).
        className="flex h-9 w-9 touch-manipulation select-none items-center justify-center rounded hover:bg-black/5 [-webkit-touch-callout:none]"
      >
        <ModeIcon mode={preference} />
        <span className="sr-only">{fmt(labels.toggle, { mode: modeName[preference] })}</span>
      </button>
      {/* Referenced by aria-describedby; hidden content still counts there. */}
      <span id={hintId} hidden>
        {hint}
      </span>
      <span role="status" className="sr-only">
        {announcement}
      </span>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={labels.menu}
          onKeyDown={onMenuKeyDown}
          onKeyUp={onMenuKeyUp}
          onContextMenu={onMenuContextMenu}
          className="absolute end-0 top-full z-50 mt-1 w-56 rounded border border-black/10 bg-white p-1 text-sm shadow-lg"
        >
          <div role="group" aria-label={labels.label}>
            {PREFERENCES.map((p, i) => (
              <button
                key={p}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={preference === p}
                tabIndex={active === i ? 0 : -1}
                onClick={() => choose(p)}
                className={itemClass}
              >
                <span aria-hidden className="flex w-4 justify-center">
                  {preference === p ? <CheckIcon /> : null}
                </span>
                <ModeIcon mode={p} />
                <span>{modeName[p]}</span>
              </button>
            ))}
          </div>
          {deepFry ? (
            <>
              <div role="separator" className="my-1 border-t border-black/10" />
              <button
                ref={(el) => {
                  itemRefs.current[FRY_INDEX] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={active === FRY_INDEX ? 0 : -1}
                onClick={toggleFry}
                className={itemClass}
              >
                <span aria-hidden className="flex w-4 justify-center" />
                <span aria-hidden className="w-[18px] text-center leading-none">
                  🍳
                </span>
                <span>{fried ? labels.unfry : labels.deepFry}</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Sun, moon, or a half-filled disc for "Match device"; decorative beside the text label. */
function ModeIcon({ mode }: { mode: ThemePreference }) {
  const common = {
    'aria-hidden': true,
    width: 18,
    height: 18,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 1.75v2M10 16.25v2M1.75 10h2M16.25 10h2M4.17 4.17l1.41 1.41M14.42 14.42l1.41 1.41M4.17 15.83l1.41-1.41M14.42 5.58l1.41-1.41" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
