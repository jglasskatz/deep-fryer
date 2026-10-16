'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { cachePageMessage } from './cache-page';
import {
  getPwaState,
  getServerPwaState,
  requestUpdateReload,
  setPwaState,
  shouldReloadOnControllerChange,
  subscribePwa,
  type BeforeInstallPromptEvent,
} from './pwa-store';

/** Ask the controlling worker, if any, to keep the page being shown. */
function postCurrentPage(sent: Set<string>) {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  controller.postMessage(cachePageMessage(window.location.href, resources, sent));
}

const workerEnabled = () => 'serviceWorker' in navigator && process.env.NODE_ENV === 'production';

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
 *
 * It also tells the worker which page is showing (CACHE_PAGE, cache-page.ts)
 * after every in-app navigation and when a worker first takes control, so
 * pages reached by a link — which load as RSC payloads the worker does not
 * store — and the very first visit are available offline too. The worker
 * applies its usual rule (public pages only) and skips pages it stored a
 * moment ago.
 */
export function ServiceWorkerRegistrar({
  labels = { updateAvailable: 'A new version is available.', reload: 'Reload' },
}: {
  /** In the reader's language (the root layout passes the catalog's words). */
  labels?: { updateAvailable: string; reload: string };
}) {
  const { waitingWorker } = useSyncExternalStore(subscribePwa, getPwaState, getServerPwaState);
  const pathname = usePathname();
  /** Static files this tab has already listed to the worker. */
  const sentAssets = useRef<Set<string>>(new Set());

  // Each page the router shows. On a document load the worker has usually
  // just stored the page and skips it; after an in-app navigation it has not.
  useEffect(() => {
    if (workerEnabled()) postCurrentPage(sentAssets.current);
  }, [pathname]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPwaState({ installPrompt: e as BeforeInstallPromptEvent });
    };
    const onInstalled = () => setPwaState({ installPrompt: null });
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (!workerEnabled()) {
      return () => {
        window.removeEventListener('beforeinstallprompt', onPrompt);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }

    let refreshing = false;
    let updateTimer: number | undefined;
    const onControllerChange = () => {
      if (refreshing) return;
      // Reload only for an update this tab asked for (pwa-store.ts): never for the first install's claim.
      if (shouldReloadOnControllerChange()) {
        refreshing = true;
        window.location.reload();
        return;
      }
      // A worker now controls this page but saw none of it load (the first
      // visit): hand it the page and the files it needs to start offline.
      postCurrentPage(sentAssets.current);
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
        onClick={() => requestUpdateReload(waitingWorker)}
      >
        {labels.reload}
      </button>
    </div>
  );
}
