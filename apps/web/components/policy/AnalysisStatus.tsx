'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type AnalysisStatusValue = 'queued' | 'running' | 'complete' | 'failed';

const POLL_MS = 5_000;

/**
 * Past these, the status line says the analysis is taking longer than usual.
 * A queued analysis normally starts within seconds; a running one usually
 * finishes in a few minutes, though a session that is retried runs twice.
 */
const QUEUED_LONG_MS = 10 * 60_000;
const RUNNING_LONG_MS = 30 * 60_000;

const TEXT: Record<AnalysisStatusValue, string> = {
  queued: 'Queued — waiting for the analysis worker. This page updates on its own.',
  running:
    'Running — reading the brief and searching for sources. This usually takes a few minutes; this page updates on its own.',
  complete: 'Analysis complete.',
  failed: 'Analysis failed.',
};

// The thresholds are stated, not a running count of minutes: the line is a
// live region, and a count would be re-announced every minute.
const QUEUED_LONG =
  'Queued for more than 10 minutes, which is longer than usual: the analysis worker may be stopped. The research session stays reserved until the analysis runs or is cancelled — cancel it below to release the session now, and ask your administrator to check the worker.';
const RUNNING_LONG =
  'Running for more than 30 minutes, which is longer than usual. It will still finish or fail on its own — if the worker stopped mid-run, the analysis is marked failed when the worker restarts, and failed analyses are not counted against your plan. If this persists, ask your administrator to check the worker.';
const OFFLINE = 'You are offline — this page will update when you reconnect.';

/**
 * The analysis's status line, live.
 *
 * While the analysis is queued or running it asks the server for just the
 * status (`statusUrl`, a few bytes) every five seconds and re-renders the
 * page with router.refresh() only when the status has changed — not on
 * every tick. Two reasons: a refresh re-sends the whole page, brief
 * included (up to 60,000 characters) — a lot of mobile data over a
 * multi-minute run — and when a refresh's request fails, Next falls back to
 * a full browser navigation, so on a dropped connection the page would turn
 * into the browser's offline error. A status poll that fails is caught here
 * instead: the line says the reader is offline, polling waits for the
 * `online` event, and the page catches up on reconnect.
 *
 * It stays mounted across the change, so the polite status region announces
 * "Analysis complete" or "Analysis failed" when the result arrives rather
 * than going silent. Polling pauses while the tab is hidden.
 *
 * `renderedAt` is the server's clock when the page rendered; the first
 * render uses it rather than the browser's clock so server and client
 * agree on whether the analysis is already taking long (no hydration
 * mismatch). Later ticks use the browser's clock.
 */
export function AnalysisStatus({
  status,
  statusUrl,
  createdAt,
  startedAt,
  renderedAt,
}: {
  status: AnalysisStatusValue;
  statusUrl: string;
  createdAt: string;
  startedAt: string | null;
  renderedAt: string;
}) {
  const router = useRouter();
  const active = status === 'queued' || status === 'running';
  const [now, setNow] = useState(() => Date.parse(renderedAt));
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      setNow(Date.now());
      if (document.visibilityState !== 'visible' || inFlight) return;
      if (!navigator.onLine) {
        setOffline(true);
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(statusUrl, { cache: 'no-store', headers: { accept: 'application/json' } });
        if (stopped) return;
        setOffline(false);
        // 403/404 (signed out, removed): leave the page as it is; a reload
        // shows the reason. Only a real change re-renders the page.
        if (!res.ok) return;
        const body = (await res.json()) as { status?: AnalysisStatusValue };
        if (!stopped && body.status && body.status !== status) router.refresh();
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        inFlight = false;
      }
    };

    const id = window.setInterval(poll, POLL_MS);
    const onOnline = () => {
      setOffline(false);
      void poll();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [active, status, statusUrl, router]);

  const since = status === 'running' ? Date.parse(startedAt ?? createdAt) : Date.parse(createdAt);
  const long =
    (status === 'queued' && now - since > QUEUED_LONG_MS) ||
    (status === 'running' && now - since > RUNNING_LONG_MS);
  const text = long ? (status === 'queued' ? QUEUED_LONG : RUNNING_LONG) : TEXT[status];

  return (
    <p role="status" aria-live="polite" className="text-sm">
      {active ? (
        <span aria-hidden className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[color:var(--color-accent)] motion-reduce:animate-none" />
      ) : null}
      {text}
      {active && offline ? <span className="mt-1 block font-medium">{OFFLINE}</span> : null}
    </p>
  );
}
