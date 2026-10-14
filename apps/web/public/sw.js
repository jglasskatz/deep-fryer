/*
 * deep-fryer service worker (SPEC-v4 §5).
 *
 * Purpose: an installed app that still shows a city's published portrait in
 * a basement community-board meeting with no signal, without ever storing a
 * signed-in person's pages on a shared municipal computer.
 *
 *   /_next/static/*            cache-first (content-hashed, immutable)
 *   public page navigations    network-first; cached only when the server
 *                              marks the response `x-df-cache: public`
 *                              (no session cookie), served from cache when
 *                              the network fails — else an offline page this
 *                              worker renders itself (plain HTML, no scripts
 *                              to load, listing the pages saved on the device)
 *   images (evidence, icons)   stale-while-revalidate, bounded
 *   admin, account, billing,
 *   auth, API, RSC payloads    network only — never cached
 *
 * Bump VERSION whenever this file's behavior changes; the page shows an
 * "update available" prompt and activation waits for the user.
 */
const VERSION = 'v2';
const STATIC = `df-static-${VERSION}`;
const PAGES = `df-pages-${VERSION}`;
const IMAGES = `df-images-${VERSION}`;
const KEEP = new Set([STATIC, PAGES, IMAGES]);
const PRECACHE = ['/icons/icon-192.png', '/icons/icon.svg', '/manifest.webmanifest'];
const MAX_PAGES = 60;
const MAX_IMAGES = 250;
const NETWORK_TIMEOUT_MS = 6000;

const NEVER_CACHE = [
  /^\/api\//,
  /^\/login/,
  /^\/account/,
  /^\/start/,
  /^\/invite\//,
  /^\/o\/[^/]+\/billing/,
  /^\/[^/]+\/admin(\/|$)/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { credentials: 'omit' })
            .then((res) => (res.ok ? cache.put(url, res) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('df-') && !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  // Sent on sign-out, belt and braces: signed-in pages are never cached anyway.
  if (event.data?.type === 'CLEAR_PAGES') event.waitUntil(caches.delete(PAGES));
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]);
    if (response.ok && response.type === 'basic' && response.headers.get('x-df-cache') === 'public') {
      await cache.put(request, response.clone());
      trim(PAGES, MAX_PAGES);
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    return offlinePage(cache);
  }
}

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The offline fallback, rendered here rather than precached from the app:
 * an app page needs its JavaScript chunks to hydrate, and a page that was
 * never opened has none cached. Plain HTML cannot fail that way.
 */
async function offlinePage(pageCache) {
  const saved = (await pageCache.keys())
    .map((r) => new URL(r.url))
    .filter((u) => u.origin === self.location.origin)
    .map((u) => u.pathname + u.search)
    .sort();
  const items = saved.length
    ? `<ul>${saved.map((p) => `<li><a href="${escapeHtml(p)}">${escapeHtml(p === '/' ? 'Home' : p)}</a></li>`).join('')}</ul>`
    : '<p class="muted">No pages are saved on this device yet. Open a portrait while online and it will be available here next time.</p>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · deep-fryer</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#fafaf7;max-width:36rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.5rem;margin:.5rem 0}.muted{color:#6b7280}a{color:#1a1a1a}li{margin:.25rem 0}</style></head><body><main id="main"><div aria-hidden="true" style="font-size:2.5rem">🍩</div><h1>You're offline</h1><p class="muted">This page isn't saved on this device. Portraits you opened recently are still available:</p>${items}<p class="muted" style="font-size:.8rem;margin-top:2rem">Saved pages show the portrait as it was when you last opened it. Reconnect for the latest published data.</p></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(IMAGES);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone());
        trim(IMAGES, MAX_IMAGES);
      }
      return response;
    })
    .catch(() => cached);
  return cached ?? refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (!sameOrigin) return;
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;
  // React Server Component payloads vary by router state; let them hit the
  // network, and if offline Next falls back to a full navigation (below).
  if (url.searchParams.has('_rsc') || request.headers.get('RSC') === '1') return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  }
});
