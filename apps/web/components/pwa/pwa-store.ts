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
