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
 *                              (no session cookie), served from cache or
 *                              /offline when the network fails
 *   images (evidence, icons)   stale-while-revalidate, bounded
 *   admin, account, billing,
 *   auth, API, RSC payloads    network only — never cached
 *
 * Bump VERSION whenever this file's behavior changes; the page shows an
 * "update available" prompt and activation waits for the user.
 */
const VERSION = 'v1';
const STATIC = `df-static-${VERSION}`;
const PAGES = `df-pages-${VERSION}`;
const IMAGES = `df-images-${VERSION}`;
const KEEP = new Set([STATIC, PAGES, IMAGES]);
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon.svg', '/manifest.webmanifest'];
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
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
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
