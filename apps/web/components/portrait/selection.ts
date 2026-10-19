/**
 * Selecting a dimension on the portrait page (SPEC-v7 §2), as pure helpers
 * shared by the server page and the client view.
 *
 * The selection lives in the URL as `?dim=<slug>`, so a selected dimension
 * is shareable and works without JavaScript: the server page reads the
 * parameter and renders that dimension's panel, and every list row is a real
 * link to the page with the parameter set. With JavaScript the same links
 * are intercepted and the panel changes in place, the URL following along
 * through history.replaceState (no server round trip, no history entry per
 * click — Back still leaves the page rather than stepping through choices).
 *
 * Nothing here touches the DOM or React, so it runs (and is tested) anywhere.
 */

/** The query parameter that names the selected dimension. */
export const DIM_PARAM = 'dim';

/**
 * The panel's element id: the fragment no-JS links carry, so the browser
 * lands on the panel rather than at the top of the doughnut (on a phone the
 * panel is a screen below it).
 */
export const PANEL_ID = 'panel';

/**
 * The slug a `?dim=` value selects, or null when it names none of the
 * portrait's dimensions. Unknown, empty and missing values are ignored (an
 * empty panel), never an error: links get mistyped and dimensions get
 * renamed. A repeated parameter (`?dim=a&dim=b`, which Next hands over as an
 * array) uses the first, as URLSearchParams.get does.
 */
export function selectedSlugFrom(
  slugs: readonly string[],
  param: string | readonly string[] | null | undefined,
): string | null {
  const value = typeof param === 'string' ? param : param?.[0];
  if (!value) return null;
  return slugs.includes(value) ? value : null;
}

/**
 * A list row's link: the portrait page with the dimension selected. The
 * fragment makes a no-JS click land on the panel it fills.
 */
export function dimensionHref(pageHref: string, slug: string): string {
  return `${pageHref}?${DIM_PARAM}=${encodeURIComponent(slug)}#${PANEL_ID}`;
}

/** The close control's link: the page with nothing selected, still landing on the (now empty) panel. */
export function closedHref(pageHref: string): string {
  return `${pageHref}#${PANEL_ID}`;
}

/**
 * The current URL with `?dim=` set to the selection, or removed when nothing
 * is selected, for history.replaceState. The path and any other parameters
 * are kept; the fragment is dropped, because `#panel` only exists to land
 * no-JS readers on the panel and would make a later reload jump past the
 * doughnut. Returned path-relative (same origin by construction).
 */
export function urlWithSelection(current: string, slug: string | null): string {
  const url = new URL(current);
  if (slug) url.searchParams.set(DIM_PARAM, slug);
  else url.searchParams.delete(DIM_PARAM);
  return `${url.pathname}${url.search}`;
}

/** The parts of a click event that decide whether to handle it in place. */
export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * Whether a click on a row link should select in place: a plain primary-button
 * click. A modified click (Cmd/Ctrl for a new tab, Shift for a new window,
 * Alt to download) or a middle click keeps the link's own behaviour, which
 * is why the rows are real links in the first place.
 */
export function isPlainClick(e: ClickLike): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}
