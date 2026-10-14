'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getPwaState,
  getServerPwaState,
  setPwaState,
  subscribePwa,
  type BeforeInstallPromptEvent,
} from './pwa-store';

/**
 * Registers /sw.js (production builds only — a caching worker in `next dev`
 * would serve stale bundles) and surfaces two moments:
 *
 * - an update: a new worker installed and waiting → "A new version is
 *   available · Reload". Reload tells the waiting worker to activate
 *   (SKIP_WAITING) and refreshes once it controls the page, so a published
 *   portrait correction reaches an installed app without a manual cache
 *   clear;
 * - an install offer: the browser's beforeinstallprompt is stashed for
 *   InstallAppButton.
 */
export function ServiceWorkerRegistrar({
  labels = { updateAvailable: 'A new version is available.', reload: 'Reload' },
}: {
  /** In the reader's language (the root layout passes the catalog's words). */
  labels?: { updateAvailable: string; reload: string };
}) {
  const { waitingWorker } = useSyncExternalStore(subscribePwa, getPwaState, getServerPwaState);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPwaState({ installPrompt: e as BeforeInstallPromptEvent });
    };
    const onInstalled = () => setPwaState({ installPrompt: null });
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') {
      return () => {
        window.removeEventListener('beforeinstallprompt', onPrompt);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }

    let refreshing = false;
    let updateTimer: number | undefined;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        const track = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            // Only an *update* needs a prompt; the first install just activates.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setPwaState({ waitingWorker: worker });
            }
          });
        };
        if (registration.waiting && navigator.serviceWorker.controller) {
          setPwaState({ waitingWorker: registration.waiting });
        }
        track(registration.installing);
        registration.addEventListener('updatefound', () => track(registration.installing));
        // Long-lived tabs (a dashboard left open in a council chamber) still pick up releases.
        updateTimer = window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      })
      .catch((err) => console.warn('service worker registration failed', err));

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (updateTimer !== undefined) window.clearInterval(updateTimer);
    };
  }, []);

  if (!waitingWorker) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-black px-4 py-3 text-sm text-white shadow-lg print:hidden"
    >
      <span>{labels.updateAvailable}</span>
      <button
        type="button"
        className="rounded bg-white px-3 py-1 font-medium text-black"
        onClick={() => waitingWorker.postMessage({ type: 'SKIP_WAITING' })}
      >
        {labels.reload}
      </button>
    </div>
  );
}
