'use client';

import { useEffect, useRef } from 'react';

/*
 * Keeping unsaved changes from being lost by leaving the page. While
 * `active`, four ways out are held:
 *
 * - a link on the page (the header's, "← Admin", a dimension): the click is
 *   stopped and `onLeave(href)` asks first;
 * - the browser's Back button: a second entry for this same page is added to
 *   the history, so Back only steps onto it, and `onLeave(null)` asks;
 * - reloading, closing the tab or typing another address: the browser's own
 *   "Leave site?" question, the only one it allows there.
 *
 * Links that open in a new tab, downloads and links within the page are
 * left alone: nothing is lost by them.
 *
 * When the page is the first in its tab (opened from an email, say), Back
 * has nowhere to go: `onNowhere` is called, so the page can show what the
 * person chose rather than stay as it was with the guard quietly off.
 */

export interface LeaveGuard {
  /** Leave after all: to `href`, or Back when null. The guard is lifted first. */
  leave: (href: string | null) => void;
  /** Stay on the page after Back was pressed: the extra history entry is put back. */
  stay: () => void;
}

/** The address a click on a link would leave the page for, or null when it would not leave (or is not a plain click). */
export function leavingHref(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>,
  anchor: Pick<HTMLAnchorElement, 'href' | 'target' | 'hasAttribute'> | null,
  here: string,
): string | null {
  if (!anchor || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return null;
  if (!anchor.href) return null;
  const to = new URL(anchor.href, here);
  const from = new URL(here);
  // A link to a part of this same page (#row-…) does not leave it.
  if (to.origin === from.origin && to.pathname === from.pathname && to.search === from.search) return null;
  return to.href;
}

/** What going Back needs from the window, so it can be tried in a test. */
export interface BackTarget {
  history: Pick<History, 'back'>;
  addEventListener(type: 'popstate' | 'pagehide', listener: () => void): void;
  removeEventListener(type: 'popstate' | 'pagehide', listener: () => void): void;
}

/** How long Back is given to start before the page takes it that there was nowhere to go. */
export const BACK_WAIT_MS = 700;

/**
 * Go Back one page, and call `onNowhere` when nothing happened: no step in
 * the history (popstate) and no page leaving (pagehide) within `wait`. Both
 * are what the browser does when there is an earlier page, in this site or
 * another.
 */
export function goBackOrElse(target: BackTarget, onNowhere: () => void, wait = BACK_WAIT_MS): void {
  let moved = false;
  const mark = () => {
    moved = true;
  };
  target.addEventListener('popstate', mark);
  target.addEventListener('pagehide', mark);
  target.history.back();
  setTimeout(() => {
    target.removeEventListener('popstate', mark);
    target.removeEventListener('pagehide', mark);
    if (!moved) onNowhere();
  }, wait);
}

export function useLeaveGuard(
  active: boolean,
  onLeave: (href: string | null) => void,
  /** Called once the extra history entry has been taken off again, after the guard is lifted. */
  onSettled?: () => void,
  /** Called when leaving by Back was chosen but there is no earlier page in the tab. */
  onNowhere?: () => void,
): LeaveGuard {
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onNowhereRef = useRef(onNowhere);
  onNowhereRef.current = onNowhere;
  const pushed = useRef(false);
  const lifted = useRef(false);

  useEffect(() => {
    if (!active) return;
    lifted.current = false;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (lifted.current) return;
      event.preventDefault();
      // Older browsers show the question only when this is set.
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (lifted.current) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      const href = leavingHref(event, anchor ?? null, window.location.href);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      onLeaveRef.current(href);
    };
    const popState = () => {
      if (lifted.current || !pushed.current) return;
      // Back stepped off the extra entry onto this page's own: still here.
      pushed.current = false;
      onLeaveRef.current(null);
    };

    if (!pushed.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      pushed.current = true;
    }
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', popState);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', popState);
    };
  }, [active]);

  // Once nothing is at stake (saved, or put back), the extra entry is taken off again.
  useEffect(() => {
    if (active || !pushed.current) return;
    pushed.current = false;
    const settled = () => {
      window.removeEventListener('popstate', settled);
      // After the router has handled the same step.
      setTimeout(() => onSettledRef.current?.(), 0);
    };
    window.addEventListener('popstate', settled);
    window.history.back();
  }, [active]);

  return {
    leave(href) {
      lifted.current = true;
      if (href === null) {
        // Already on this page's own entry: one more step is the page before it, if there is one.
        goBackOrElse(window, () => onNowhereRef.current?.());
      } else {
        window.location.assign(href);
      }
    },
    stay() {
      if (pushed.current) return;
      window.history.pushState(window.history.state, '', window.location.href);
      pushed.current = true;
    },
  };
}
