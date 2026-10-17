'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered staff page current while something on it is still
 * changing — a research run that is queued or running (the run page, the
 * runs list), the draft doughnut filling in as findings land. It calls
 * router.refresh() every `everyMs` while `active`: the server components
 * render again with fresh data and React swaps in only what changed, so
 * scroll position, an open disclosure and focus all survive.
 *
 * It renders nothing. Pages put their changing summary in a polite live
 * region of their own (role="status"), which is what a screen reader should
 * hear; a component that announced "refreshed" every few seconds would only
 * be noise.
 *
 * A hidden tab does not refresh (each refresh is a server render and a few
 * queries, for nobody to see); coming back refreshes at once and resumes
 * the interval, so the page is never shown stale. When the page stops being
 * `active` — the run settled — the timer stops with it.
 */
export function AutoRefresh({ everyMs, active }: { everyMs: number; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    return startAutoRefresh({ everyMs, refresh: () => router.refresh() });
  }, [active, everyMs, router]);
  return null;
}

/** The fewest milliseconds between refreshes, whatever a caller passes: each one is a full server render. */
export const MIN_REFRESH_MS = 2_000;

/** The parts of `document` the timer reads; a test passes its own. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * The timer behind AutoRefresh, apart from React so it can be tested with
 * fake timers: refresh every `everyMs` while the page is visible, stop while
 * it is hidden, refresh immediately on becoming visible again. Returns the
 * function that stops it for good (the effect's cleanup).
 */
export function startAutoRefresh({
  everyMs,
  refresh,
  doc = document,
}: {
  everyMs: number;
  refresh: () => void;
  doc?: VisibilitySource;
}): () => void {
  const interval = Math.max(MIN_REFRESH_MS, Number.isFinite(everyMs) ? everyMs : MIN_REFRESH_MS);
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = setInterval(refresh, interval);
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      stop();
    } else if (timer === null) {
      refresh();
      start();
    }
  };
  if (doc.visibilityState !== 'hidden') start();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
