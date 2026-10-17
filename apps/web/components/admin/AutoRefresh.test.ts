import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_REFRESH_MS, startAutoRefresh, type VisibilitySource } from './AutoRefresh';

/** A stand-in for `document`: its visibility can be flipped and listeners fired. */
function fakeDocument(initial: 'visible' | 'hidden' = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as string,
    addEventListener: (_: 'visibilitychange', l: () => void) => listeners.add(l),
    removeEventListener: (_: 'visibilitychange', l: () => void) => listeners.delete(l),
  } satisfies VisibilitySource;
  const set = (state: 'visible' | 'hidden') => {
    doc.visibilityState = state;
    for (const l of listeners) l();
  };
  return { doc, set, listeners };
}

describe('startAutoRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes every interval while visible, and stops for good when stopped', () => {
    const refresh = vi.fn();
    const { doc, listeners } = fakeDocument();
    const stop = startAutoRefresh({ everyMs: 5_000, refresh, doc });
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(listeners.size).toBe(0);
  });

  it('pauses while the tab is hidden and catches up at once when it comes back', () => {
    const refresh = vi.fn();
    const { doc, set } = fakeDocument();
    const stop = startAutoRefresh({ everyMs: 5_000, refresh, doc });
    set('hidden');
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    set('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('starts paused in a hidden tab, and never refreshes faster than the floor', () => {
    const refresh = vi.fn();
    const hidden = fakeDocument('hidden');
    const stopHidden = startAutoRefresh({ everyMs: 5_000, refresh, doc: hidden.doc });
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
    stopHidden();

    const { doc } = fakeDocument();
    const stop = startAutoRefresh({ everyMs: 10, refresh, doc });
    vi.advanceTimersByTime(MIN_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});
