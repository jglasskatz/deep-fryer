/**
 * The page's half of offline coverage for pages the service worker never
 * saw load (public/sw.js, CACHE_PAGE): an in-app navigation fetches a React
 * Server Component payload, which the worker does not store, and the first
 * visit loads before the worker controls the tab. So ServiceWorkerRegistrar
 * tells the worker which page is showing; the worker fetches and stores it
 * by the same `x-df-cache: public` rule as a visit.
 *
 * `assets` lists the page's /_next/static files (scripts, styles, fonts) the
 * browser has loaded, so a page first opened before the worker took control
 * can still start offline. Each is sent once per tab (`sent`); the worker
 * fetches only the ones it does not already hold.
 */
export interface CachePageMessage {
  type: 'CACHE_PAGE';
  /** Path and query of the page being shown. */
  url: string;
  /** Same-origin /_next/static paths not sent before. */
  assets: string[];
}

export function cachePageMessage(href: string, resources: readonly string[], sent: Set<string>): CachePageMessage {
  const here = new URL(href);
  const assets: string[] = [];
  for (const name of resources) {
    let url: URL;
    try {
      url = new URL(name, here);
    } catch {
      continue;
    }
    if (url.origin !== here.origin || !url.pathname.startsWith('/_next/static/')) continue;
    const path = url.pathname + url.search;
    if (sent.has(path)) continue;
    sent.add(path);
    assets.push(path);
  }
  return { type: 'CACHE_PAGE', url: here.pathname + here.search, assets };
}
