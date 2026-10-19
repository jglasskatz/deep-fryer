'use client';

/**
 * Browser-side PWA state shared by the registrar, the install button, and
 * the update toast: the deferred install prompt and a waiting service
 * worker. A tiny subscribe/notify store so components re-render when either
 * changes, without a context provider in the root layout.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  installPrompt: BeforeInstallPromptEvent | null;
  waitingWorker: ServiceWorker | null;
}

let state: PwaState = { installPrompt: null, waitingWorker: null };
const listeners = new Set<() => void>();

export function getPwaState(): PwaState {
  return state;
}

export function setPwaState(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: PwaState = { installPrompt: null, waitingWorker: null };
export function getServerPwaState(): PwaState {
  return SERVER_STATE;
}

/**
 * Whether this tab asked for the waiting worker to take over (the reader
 * pressed "Reload" on the update toast). The page reloads on the
 * service worker's controllerchange only then: the first install also
 * changes the controller (the new worker claims the page it was installed
 * from), and reloading for that would throw away whatever a first-time
 * visitor had started — a half-filled form, a scroll position — a few
 * seconds after the page loaded. Another tab accepting an update does not
 * reload this one either; it picks up the new worker on its next navigation.
 */
let updateRequested = false;

/** The toast's Reload: remember the request, then tell the waiting worker to activate. */
export function requestUpdateReload(worker: Pick<ServiceWorker, 'postMessage'>): void {
  updateRequested = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
}

export function shouldReloadOnControllerChange(): boolean {
  return updateRequested;
}

/** For tests: forget a request. */
export function resetUpdateRequestForTests(): void {
  updateRequested = false;
}
