/**
 * Dismissing the header's disclosure menus — language, "Request a
 * translation", account, and the phone Menu: each a `<details>` in one
 * exclusive group (`name="df-header-menu"`), so they open and close with no
 * JavaScript at all. A bare <details> stays open until its summary is
 * pressed again, though: Escape does nothing, and Tab walks focus out of it
 * while the panel stays drawn — on a phone over the very links focus moves
 * to, hiding the focus ring (WCAG 2.4.7, 2.4.11). With script, these rules
 * close a menu the way the theme menu closes (components/theme/ThemeToggle):
 *
 * - Escape inside an open menu closes it and returns focus to its summary;
 *   it calls preventDefault, which also tells DeepFryLayer this Escape was
 *   spent and must not un-fry the page as well.
 * - Focus moving to something outside an open menu closes it. A focusout
 *   with no new target (the window losing focus, Safari not focusing a
 *   clicked button) leaves it open.
 * - A pointer press outside every open menu closes them.
 *
 * Kept free of DOM globals so the rules are tested as plain functions
 * (header-menus.test.ts); HeaderMenuDismiss wires them to the document.
 */

/** An open menu of the group. */
export const OPEN_HEADER_MENU = 'details[name="df-header-menu"][open]';

/** The parts of a <details> element these rules use. */
export interface MenuElement {
  open: boolean;
  contains(node: unknown): boolean;
  querySelector(selector: 'summary'): { focus(): void } | null;
}

/** The parts of the document these rules use (its matches are <details> elements). */
export interface MenuDocument {
  body: unknown;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

const openMenus = (doc: MenuDocument) => Array.from(doc.querySelectorAll(OPEN_HEADER_MENU)) as MenuElement[];

/** The open header menu an event target sits in, if any. */
export function menuAround(target: unknown): MenuElement | null {
  const el = target as { closest?: (selector: string) => unknown } | null;
  if (!el || typeof el.closest !== 'function') return null;
  return (el.closest(OPEN_HEADER_MENU) as MenuElement | null) ?? null;
}

/** The parts of a keydown event onMenuKeyDown reads. */
export interface MenuKeyEvent {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  target: unknown;
  preventDefault(): void;
}

/**
 * Escape closes the open menu it was pressed in and puts focus back on that
 * menu's summary. Pressed with focus on nothing in particular (the body:
 * Safari does not focus a clicked summary), it closes whichever menu is
 * open. An Escape some widget already used, or one that cancels an IME
 * composition, is left alone. Returns whether a menu was closed.
 */
export function onMenuKeyDown(event: MenuKeyEvent, doc: MenuDocument): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return false;
  const inside = menuAround(event.target);
  const menu = inside ?? (event.target === doc.body ? (openMenus(doc)[0] ?? null) : null);
  if (!menu) return false;
  event.preventDefault();
  menu.open = false;
  menu.querySelector('summary')?.focus();
  return true;
}

/**
 * Focus leaving an open menu for an element outside it closes the menu
 * (Tab past its last item, Shift+Tab out, a screen reader's cursor moving
 * on). Returns whether a menu was closed.
 */
export function onMenuFocusOut(event: { target: unknown; relatedTarget: unknown }): boolean {
  const menu = menuAround(event.target);
  if (!menu || !event.relatedTarget || menu.contains(event.relatedTarget)) return false;
  menu.open = false;
  return true;
}

/**
 * A press outside an open menu closes it; one inside (its summary included,
 * whose own toggle then runs) leaves it to the browser. pointerdown rather
 * than click, as in the theme menu, so the menu is gone before the press
 * lands on whatever it covered. Returns how many menus were closed.
 */
export function onMenuPointerDown(event: { target: unknown }, doc: MenuDocument): number {
  let closed = 0;
  for (const menu of openMenus(doc)) {
    if (menu.contains(event.target)) continue;
    menu.open = false;
    closed++;
  }
  return closed;
}
