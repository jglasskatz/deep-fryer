'use client';

import { useState } from 'react';

/**
 * "Save for offline" (SPEC-v5 §3): asks the service worker to store this
 * emergency page and the portrait's front page, in the reader's language,
 * before the network goes down in a storm. The worker applies the same rule
 * as an ordinary visit (public/sw.js: only `x-df-cache: public` responses),
 * so a signed-in person's pages are refused, and it answers per URL over a
 * MessageChannel so the outcome can be stated plainly.
 *
 * Saved copies live in their own cache, which survives app updates and is
 * not pushed out by ordinary browsing (public/sw.js), and the page asks the
 * browser to keep this site's storage (navigator.storage.persist) so it is
 * not evicted when space runs low.
 *
 * App updates wait for the reader (ServiceWorkerRegistrar), so the active
 * worker can be an older one that does not know CACHE_URLS. The request
 * goes to the newest installed worker — a waiting one receives messages,
 * and its cache is the one that serves once it takes over — after a quick
 * PING: a worker that does not answer within seconds is outdated, and the
 * reader is told to reload rather than to "try again with a connection".
 *
 * The result is announced through an aria-live region; nothing depends on
 * the button's colour or position.
 */

export interface SaveForOfflineLabels {
  title: string;
  body: string;
  save: string;
  saving: string;
  saved: string;
  failed: string;
  unavailable: string;
  signedIn: string;
  /** The installed app is too old to save pages: reload to update it. */
  outdated: string;
}

type Status = 'idle' | 'saving' | 'saved' | 'failed' | 'unavailable' | 'signedIn' | 'outdated';

interface CacheResult {
  url: string;
  ok: boolean;
  reason?: string;
}

/** Longer than the worker's per-page timeout (15 s), so its answer always arrives first. */
const REPLY_TIMEOUT_MS = 30_000;
/** A worker that knows CACHE_URLS answers PING at once (starting it takes well under this). */
const PING_TIMEOUT_MS = 3_000;

/** Post a message over its own channel and wait for the reply, or null after `ms`. */
function ask<T>(worker: ServiceWorker, message: Record<string, unknown>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, ms);
    channel.port1.onmessage = (event: MessageEvent<T>) => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export function SaveForOffline({ urls, labels }: { urls: string[]; labels: SaveForOfflineLabels }) {
  const [status, setStatus] = useState<Status>('idle');

  async function save() {
    if (!('serviceWorker' in navigator)) {
      setStatus('unavailable');
      return;
    }
    setStatus('saving');
    // Best effort: the browser may decline (or not offer) persistence.
    void navigator.storage?.persist?.().catch(() => false);
    try {
      // The newest installed worker: a waiting update if there is one (an
      // older active worker may not know CACHE_URLS), else the active one,
      // which answers even before it controls this tab (first visit).
      const registration = await navigator.serviceWorker.getRegistration();
      const worker = registration?.waiting ?? registration?.active ?? navigator.serviceWorker.controller;
      if (!worker) {
        setStatus('unavailable');
        return;
      }
      if (!(await ask<{ type?: string }>(worker, { type: 'PING' }, PING_TIMEOUT_MS))) {
        setStatus('outdated');
        return;
      }
      // Also the exact address being read (it may carry ?hazard=…), so the
      // offline copy opens where the reader saved it.
      const here = window.location.pathname + window.location.search;
      const reply = await ask<{ results?: CacheResult[] }>(worker, { type: 'CACHE_URLS', urls: [...new Set([...urls, here])] }, REPLY_TIMEOUT_MS);
      const results = Array.isArray(reply?.results) ? reply.results : [];
      if (results.length > 0 && results.every((r) => r.ok)) setStatus('saved');
      else if (results.some((r) => r.reason === 'private')) setStatus('signedIn');
      else setStatus('failed');
    } catch {
      setStatus('failed');
    }
  }

  const message =
    status === 'saving'
      ? labels.saving
      : status === 'saved'
        ? labels.saved
        : status === 'failed'
          ? labels.failed
          : status === 'unavailable'
            ? labels.unavailable
            : status === 'signedIn'
              ? labels.signedIn
              : status === 'outdated'
                ? labels.outdated
                : '';

  return (
    <div className="rounded-lg border border-black/15 p-4 print:hidden">
      <h2 id="offline" className="text-lg font-semibold">
        {labels.title}
      </h2>
      <p className="mt-1 text-sm text-[color:var(--color-muted)]">{labels.body}</p>
      <button
        type="button"
        onClick={save}
        disabled={status === 'saving'}
        className="mt-3 rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === 'saving' ? labels.saving : labels.save}
      </button>
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {status === 'saving' ? '' : message}
      </p>
    </div>
  );
}
