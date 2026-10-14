'use client';

import { useEffect, useState } from 'react';

/** Lists public pages the service worker has saved, so offline visitors can still reach them. */
export function OfflinePages() {
  const [pages, setPages] = useState<string[] | null>(null);
  useEffect(() => {
    if (!('caches' in window)) return setPages([]);
    caches
      .keys()
      .then(async (keys) => {
        const pageCache = keys.find((k) => k.startsWith('df-pages-'));
        if (!pageCache) return [];
        const requests = await (await caches.open(pageCache)).keys();
        return requests.map((r) => new URL(r.url).pathname).filter((p) => p !== '/offline');
      })
      .then((paths) => setPages([...new Set(paths)].sort()))
      .catch(() => setPages([]));
  }, []);
  if (pages === null) return null;
  if (pages.length === 0) {
    return <p className="text-sm text-[color:var(--color-muted)]">No portraits are saved on this device yet. Open a portrait while online and it will be available here next time.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {pages.map((p) => (
        <li key={p}>
          <a className="underline" href={p}>
            {p === '/' ? 'Home' : p}
          </a>
        </li>
      ))}
    </ul>
  );
}
