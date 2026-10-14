'use client';

import { useSyncExternalStore } from 'react';
import { getPwaState, getServerPwaState, setPwaState, subscribePwa } from './pwa-store';

/**
 * "Install app" — rendered only when the browser has offered an install
 * prompt (Chromium/Edge/Android). Safari users install from the share sheet;
 * nothing is shown there rather than a button that cannot work.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { installPrompt } = useSyncExternalStore(subscribePwa, getPwaState, getServerPwaState);
  if (!installPrompt) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setPwaState({ installPrompt: null });
      }}
    >
      Install app
    </button>
  );
}
