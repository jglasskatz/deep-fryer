'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * Keeps the emergency page's alerts honest after the server is gone.
 *
 * The server decides staleness and filters expired alerts when it renders,
 * but the HTML can be read much later: "save for offline" keeps a copy, and
 * the service worker serves its stored copy whenever the network is down or
 * slower than its timeout — exactly what happens in a storm. A copy saved on
 * a calm day must not keep saying "no active alerts" days later.
 *
 * So the alert list is re-judged on the reader's device, against the
 * device clock:
 *
 * - the server's verdict stands when it said the feed was stale;
 * - otherwise, once the alerts it shows were checked longer ago than the
 *   stale threshold, the page says this is an old copy (with the time it
 *   was checked and a pointer to the NWS) and stops claiming "no alerts";
 * - an alert whose end time has passed is marked as ended, and a hazard's
 *   "active now" badge hides once its alerts have all ended.
 *
 * Server rendering is unchanged (the server snapshot of the clock is
 * null), so readers without JavaScript get exactly the server's page, and
 * hydration never mismatches. Everything shown is still the server's own
 * words: this component only chooses which of them to show.
 */

// ---- The device clock, one ticker for every guard on the page -----------------------

/** Often enough that an alert's end or the stale threshold shows within a minute. */
const TICK_MS = 30_000;

let clock: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  clock = Date.now();
  for (const listener of listeners) listener();
}

// A page restored from the back-forward cache, a tab brought back, or a
// device that just reconnected: re-read the clock at once, not on the next tick.
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    // The ticker stops while nothing listens (another page of the app):
    // re-read the clock now, so a page shown again never starts stale.
    clock = Date.now();
    timer = setInterval(tick, TICK_MS);
    window.addEventListener('pageshow', tick);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      window.removeEventListener('pageshow', tick);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    }
  };
}

const getSnapshot = () => clock ?? (clock = Date.now());
const getServerSnapshot = () => null;

/** Milliseconds on the device clock, or null while rendering on the server and hydrating. */
function useDeviceNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---- The rules (pure, so they are tested without a browser) --------------------------

/**
 * Which notice the alerts section needs: 'feed' (the server could not reach
 * the feed — its own stale notice), 'copy' (this copy of the page is older
 * than the stale threshold on the device clock), or none.
 */
export function alertsNotice({
  now,
  lastSuccessAt,
  staleAfterMs,
  serverStale,
}: {
  now: number | null;
  lastSuccessAt: string | null;
  staleAfterMs: number;
  serverStale: boolean;
}): 'feed' | 'copy' | null {
  if (serverStale) return 'feed';
  if (now === null) return null;
  const checked = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  return Number.isNaN(checked) || now - checked > staleAfterMs ? 'copy' : null;
}

/** Whether something with this end time (ISO, or null for open-ended) is over on the device clock. */
export function hasEnded(until: string | null, now: number | null): boolean {
  return now !== null && until !== null && Date.parse(until) <= now;
}

// ---- Components -----------------------------------------------------------------------

export interface LiveAlert {
  id: string;
  /** ISO end time, or null when the NWS gave none. */
  until: string | null;
  /** The alert, rendered on the server. */
  card: ReactNode;
}

export function AlertsLive({
  lastSuccessAt,
  staleAfterMs,
  serverStale,
  feedNotice,
  copyNotice,
  none,
  alerts,
  endedLabel,
}: {
  lastSuccessAt: string | null;
  staleAfterMs: number;
  serverStale: boolean;
  /** The server's "could not reach the feed" notice. */
  feedNotice: ReactNode;
  /** "This copy was saved earlier; alerts were last checked …". */
  copyNotice: ReactNode;
  /** "No active alerts as of …" — shown only while that is still a claim we can make. */
  none: ReactNode;
  alerts: LiveAlert[];
  endedLabel: string;
}) {
  const now = useDeviceNow();
  const notice = alertsNotice({ now, lastSuccessAt, staleAfterMs, serverStale });
  return (
    <>
      {notice === 'feed' ? feedNotice : notice === 'copy' ? copyNotice : null}
      {alerts.length === 0 ? (
        notice ? null : none
      ) : (
        <ul className="mt-3 space-y-3">
          {alerts.map((a) => (
            <li key={a.id}>
              {hasEnded(a.until, now) ? (
                <p className="mb-1">
                  <span className="inline-block rounded border border-current px-1.5 py-0.5 text-xs font-semibold">{endedLabel}</span>
                </p>
              ) : null}
              {a.card}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Shows its children until `until` passes on the device clock (null: always). */
export function UntilEnded({ until, children }: { until: string | null; children: ReactNode }) {
  const now = useDeviceNow();
  return hasEnded(until, now) ? null : <>{children}</>;
}
