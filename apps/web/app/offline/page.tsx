import type { Metadata } from 'next';
import { OfflinePages } from '@/components/pwa/OfflinePages';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };

/**
 * Precached by the service worker and shown when a page is requested with no
 * connection and no saved copy. Deliberately free of data dependencies.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-20 sm:px-6">
      <p aria-hidden className="text-4xl">
        🍩
      </p>
      <h1 className="mt-4 text-2xl font-bold">You&apos;re offline</h1>
      <p className="mt-2 text-[color:var(--color-muted)]">
        This page isn&apos;t saved on this device. Portraits you opened recently are still
        available:
      </p>
      <div className="mt-6">
        <OfflinePages />
      </div>
      <p className="mt-8 text-xs text-[color:var(--color-muted)]">
        Saved pages show the portrait as it was when you last opened it. Reconnect for the latest
        published data.
      </p>
    </main>
  );
}
