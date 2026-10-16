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
 * A page reached without a document navigation never passes through the
 * fetch handler as a page: Next's in-app links load React Server Component
 * payloads (not cached, above), and the very first visit loads before this
 * worker controls the tab. So the app tells the worker which page it is
 * showing — { type: 'CACHE_PAGE', url, assets } after each in-app
 * navigation and once the worker first takes control
 * (components/pwa/ServiceWorkerRegistrar.tsx) — and the worker fetches that
 * page and stores it under exactly the rule a visit uses (x-df-cache:
 * public), along with the /_next/static files the page loaded before it was
 * controlled. A copy stored in the last few minutes is not fetched again,
 * and while the server has recently answered `private` (someone is signed
 * in) no page is fetched for this at all.
 *
 * Offline, a page is looked up by its address with `source` dropped (the
 * installed app's old start URL, /?source=pwa, is the home page), then
 * without `dim` too: ?dim= only picks the dimension a portrait's panel
 * shows (the page selects it again from the URL), so the stored portrait
 * beats the offline notice.
 *
 * Pages can also ask for copies ahead of need: the emergency page's "save
 * for offline" posts { type: 'CACHE_URLS', urls } (SPEC-v5 §3), and this
 * worker fetches each same-origin page and stores it under exactly the same
 * rule as a visit — only a response marked `x-df-cache: public`. Those
 * copies go in their own cache, SAVED, which is not versioned (an app
 * update keeps it) and not trimmed by ordinary browsing (it has its own
 * small cap); a visit to a saved page while online refreshes its copy. The
 * page first sends { type: 'PING' } to tell a worker that knows CACHE_URLS
 * from an older one that would never answer.
 *
 * Bump VERSION whenever this file's behavior changes; the page shows an
 * "update available" prompt and activation waits for the user.
 */
const VERSION = 'v5';
const STATIC = `df-static-${VERSION}`;
const PAGES = `df-pages-${VERSION}`;
const IMAGES = `df-images-${VERSION}`;
/** Pages a reader saved on purpose: unversioned, so updates keep them. */
const SAVED = 'df-saved';
/** One marker: when the server last answered a page `x-df-cache: private` (see notePrivacy). */
const SESSION = 'df-session';
const KEEP = new Set([STATIC, PAGES, IMAGES, SAVED, SESSION]);
const PRECACHE = ['/icons/icon-192.png', '/icons/icon.svg', '/manifest.webmanifest'];
const MAX_PAGES = 60;
/** Room for a few portraits' emergency and front pages, in a language or two. */
const MAX_SAVED = 24;
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
  // The privacy marker goes too, so the signed-out reader's pages are kept at once.
  if (event.data?.type === 'CLEAR_PAGES') {
    event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(SAVED), caches.delete(SESSION)]));
  }
  // The page an in-app navigation (or the first visit) is showing.
  if (event.data?.type === 'CACHE_PAGE') event.waitUntil(cachePage(event.data.url, event.data.assets));
  // "Save for offline" checks it is talking to a worker that can save.
  if (event.data?.type === 'PING') event.ports?.[0]?.postMessage({ type: 'PONG', version: VERSION });
  // "Save for offline": reply over the MessageChannel port the page sent.
  if (event.data?.type === 'CACHE_URLS') event.waitUntil(cacheUrls(event.data.urls, event.ports?.[0]));
});

const MAX_SAVE_URLS = 10;
const SAVE_TIMEOUT_MS = 15000;

/** Whether a response may be stored on the device (the x-df-cache contract with middleware.ts). */
function storable(response) {
  return (
    response.ok &&
    response.type === 'basic' &&
    // A redirected response cannot answer a later navigation (browsers
    // reject it), and the URL it was asked for is not the page it holds.
    !response.redirected &&
    response.headers.get('x-df-cache') === 'public'
  );
}

/**
 * Fetch and store the pages a client asked for. Only same-origin page URLs
 * outside NEVER_CACHE are considered, and each response must pass the same
 * test as networkFirstPage: a signed-in person's pages (x-df-cache: private)
 * are refused, never stored. Each URL gets its own result, so the page can
 * tell "saved" from "signed in" from "offline".
 */
async function cacheUrls(urls, port) {
  const list = Array.isArray(urls) ? urls.slice(0, MAX_SAVE_URLS) : [];
  const cache = await caches.open(SAVED);
  const results = await Promise.all(
    list.map(async (raw) => {
      let url;
      try {
        url = new URL(String(raw), self.location.origin);
      } catch {
        return { url: String(raw), ok: false, reason: 'invalid' };
      }
      const path = url.pathname + url.search;
      if (url.origin !== self.location.origin || NEVER_CACHE.some((re) => re.test(url.pathname))) {
        return { url: path, ok: false, reason: 'refused' };
      }
      try {
        const response = await Promise.race([fetch(url.href, { credentials: 'same-origin' }), timeout(SAVE_TIMEOUT_MS)]);
        if (!storable(response)) {
          const reason =
            response.headers.get('x-df-cache') === 'private'
              ? 'private'
              : response.redirected
                ? 'redirected'
                : `status ${response.status}`;
          return { url: path, ok: false, reason };
        }
        // Re-saving moves the page to the newest end, so trim drops the oldest saves first.
        await cache.delete(url.href);
        await cache.put(url.href, response);
        return { url: path, ok: true };
      } catch {
        return { url: path, ok: false, reason: 'network' };
      }
    }),
  );
  await trim(SAVED, MAX_SAVED);
  if (port) port.postMessage({ type: 'CACHE_URLS_RESULT', results });
}

/**
 * The address a page is stored under: its own, minus `source` — a tag the
 * installed app once launched with (/?source=pwa) that changes nothing on
 * the page, so it must not make a second copy of it or miss the first.
 */
function pageKey(url) {
  const u = new URL(url);
  u.searchParams.delete('source');
  return u.href;
}

/**
 * The same page with its view-only query removed: `dim` picks the dimension
 * a portrait's panel (or a list's filter) shows. Offline, any stored copy of
 * the page itself beats the offline notice; the portrait re-selects the
 * dimension from the URL on the client.
 */
function viewlessKey(url) {
  const u = new URL(pageKey(url));
  u.searchParams.delete('dim');
  return u.href;
}

/** How recently a stored page counts as fresh enough that CACHE_PAGE need not fetch it again. */
const PAGE_FRESH_MS = 5 * 60 * 1000;
/** How long a `private` answer stops CACHE_PAGE fetching (a session may also just expire). */
const PRIVATE_TTL_MS = 30 * 60 * 1000;
const PRIVATE_KEY = '/__df-session/private';
const MAX_PAGE_ASSETS = 150;
/** Page keys being fetched for CACHE_PAGE, so a burst of messages fetches each once. */
const pagesInFlight = new Set();

/**
 * Remember whether the server last said someone is signed in. Kept in Cache
 * Storage rather than a variable because the browser stops idle workers
 * within seconds; without it every in-app navigation of a signed-in reader
 * would cost the server a second render that is then refused.
 */
async function notePrivacy(response) {
  const marker = response.headers.get('x-df-cache');
  if (marker !== 'private' && marker !== 'public') return;
  const cache = await caches.open(SESSION);
  if (marker === 'public') await cache.delete(PRIVATE_KEY);
  else await cache.put(PRIVATE_KEY, new Response('', { headers: { 'x-df-at': String(Date.now()) } }));
}

async function recentlyPrivate() {
  const mark = await (await caches.open(SESSION)).match(PRIVATE_KEY);
  return Boolean(mark) && Date.now() - Number(mark.headers.get('x-df-at')) < PRIVATE_TTL_MS;
}

/**
 * CACHE_PAGE: keep the page the app is showing, and the static files it
 * loaded, as a document visit would have. Same refusals as cacheUrls
 * (other origins, NEVER_CACHE, RSC payloads, anything not `public`), no
 * reply: the page does not wait on it.
 */
async function cachePage(raw, assets) {
  await Promise.all([storePage(raw), storeAssets(assets)]);
}

async function storePage(raw) {
  let url;
  try {
    url = new URL(String(raw), self.location.origin);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || NEVER_CACHE.some((re) => re.test(url.pathname))) return;
  if (url.searchParams.has('_rsc')) return;
  const key = pageKey(url.href);
  if (pagesInFlight.has(key)) return;
  pagesInFlight.add(key);
  try {
    const cache = await caches.open(PAGES);
    const have = await cache.match(key);
    if (have && Date.now() - Date.parse(have.headers.get('date') ?? '') < PAGE_FRESH_MS) return;
    if (await recentlyPrivate()) return;
    const response = await Promise.race([fetch(url.href, { credentials: 'same-origin' }), timeout(SAVE_TIMEOUT_MS)]);
    await notePrivacy(response);
    if (!storable(response)) return;
    const saved = await caches.open(SAVED);
    const keep = (await saved.match(key)) ? response.clone() : null;
    // Re-storing moves the page to the newest end, so trim drops the oldest first.
    await cache.delete(key);
    await cache.put(key, response);
    if (keep) await saved.put(key, keep);
    await trim(PAGES, MAX_PAGES);
  } catch {
    // Offline or slow: the page simply is not stored this time.
  } finally {
    pagesInFlight.delete(key);
  }
}

/** The page's own /_next/static files (content-hashed), each fetched only if not already stored. */
async function storeAssets(list) {
  if (!Array.isArray(list)) return;
  const cache = await caches.open(STATIC);
  await Promise.all(
    list.slice(0, MAX_PAGE_ASSETS).map(async (raw) => {
      let url;
      try {
        url = new URL(String(raw), self.location.origin);
      } catch {
        return;
      }
      if (url.origin !== self.location.origin || !url.pathname.startsWith('/_next/static/')) return;
      try {
        if (await cache.match(url.href)) return;
        const response = await fetch(url.href);
        if (response.ok) await cache.put(url.href, response);
      } catch {
        // A missing chunk is fetched again the next time the page needs it.
      }
    }),
  );
}

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
  const saved = await caches.open(SAVED);
  const key = pageKey(request.url);
  try {
    const response = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]);
    // Whether someone is signed in, for CACHE_PAGE (a small write to one marker).
    await notePrivacy(response).catch(() => undefined);
    if (storable(response)) {
      // A page the reader saved stays as fresh as their last visit to it.
      // (Both copies are cloned before either is read.)
      const refreshSaved = Boolean(await saved.match(key));
      const visit = response.clone();
      const keep = refreshSaved ? response.clone() : null;
      await cache.put(key, visit);
      trim(PAGES, MAX_PAGES);
      if (keep) await saved.put(key, keep);
    }
    return response;
  } catch {
    const cached = (await cache.match(key)) ?? (await saved.match(key));
    if (cached) return cached;
    const viewless = viewlessKey(request.url);
    if (viewless !== key) {
      const page = (await cache.match(viewless)) ?? (await saved.match(viewless));
      if (page) return page;
    }
    // The emergency page's ?hazard=… only picks which threat the doughnut
    // shows: offline, any stored copy of the page beats the offline notice.
    if (/\/emergency\/?$/.test(new URL(request.url).pathname)) {
      const anyHazard = (await saved.match(request, { ignoreSearch: true })) ?? (await cache.match(request, { ignoreSearch: true }));
      if (anyHazard) return anyHazard;
    }
    return offlinePage([cache, saved], request);
  }
}

/**
 * Offline page text per URL language prefix (keep in sync with
 * lib/i18n/locales.ts — checked by lib/i18n/sw-offline.test.ts). Worded
 * around "pages" so it stands alone, without the app's catalogs.
 */
const OFFLINE = {
  en: { lang: 'en', dir: 'ltr', title: 'Offline', h1: "You're offline", intro: "This page isn't saved on this device. Pages you opened recently are still available:", none: 'No pages are saved on this device yet. Pages you open while online will be available here next time.', note: 'Saved pages show the data as it was when you last opened them. Reconnect for the latest published data.', home: 'Home' },
  es: { lang: 'es', dir: 'ltr', title: 'Sin conexión', h1: 'Está sin conexión', intro: 'Esta página no está guardada en este dispositivo. Las páginas que abrió recientemente siguen disponibles:', none: 'Aún no hay páginas guardadas en este dispositivo. Las páginas que abra con conexión estarán disponibles aquí la próxima vez.', note: 'Las páginas guardadas muestran los datos tal como estaban cuando las abrió por última vez. Vuelva a conectarse para ver los datos publicados más recientes.', home: 'Inicio' },
  'zh-hant': { lang: 'zh-Hant', dir: 'ltr', title: '離線', h1: '您目前處於離線狀態', intro: '此頁面未儲存在此裝置上。您最近開啟過的頁面仍可瀏覽：', none: '此裝置上尚未儲存任何頁面。您在連線時開啟的頁面，下次即可在此處瀏覽。', note: '已儲存的頁面顯示的是您上次開啟時的資料。請重新連線以查看最新發布的資料。', home: '首頁' },
  'zh-hans': { lang: 'zh-Hans', dir: 'ltr', title: '离线', h1: '您目前处于离线状态', intro: '此页面未保存在此设备上。您最近打开过的页面仍可浏览：', none: '此设备上尚未保存任何页面。您在联网时打开的页面，下次即可在此处浏览。', note: '已保存的页面显示的是您上次打开时的数据。请重新联网以查看最新发布的数据。', home: '首页' },
  ru: { lang: 'ru', dir: 'ltr', title: 'Нет подключения', h1: 'Нет подключения к интернету', intro: 'Эта страница не сохранена на этом устройстве. Страницы, которые вы недавно открывали, по-прежнему доступны:', none: 'На этом устройстве пока нет сохранённых страниц. Страницы, которые вы откроете при подключении к интернету, в следующий раз будут доступны здесь.', note: 'Сохранённые страницы показывают данные такими, какими они были, когда вы открывали их в последний раз. Подключитесь к интернету, чтобы увидеть последние опубликованные данные.', home: 'Главная' },
  bn: { lang: 'bn', dir: 'ltr', title: 'অফলাইন', h1: 'আপনি অফলাইনে আছেন', intro: 'এই পৃষ্ঠাটি এই ডিভাইসে সংরক্ষিত নেই। আপনি সম্প্রতি যে পৃষ্ঠাগুলো খুলেছেন সেগুলো এখনও দেখা যাবে:', none: 'এই ডিভাইসে এখনও কোনো পৃষ্ঠা সংরক্ষিত নেই। অনলাইনে থাকা অবস্থায় আপনি যে পৃষ্ঠাগুলো খুলবেন, পরের বার সেগুলো এখানে পাওয়া যাবে।', note: 'সংরক্ষিত পৃষ্ঠাগুলো আপনি শেষবার খোলার সময়ের তথ্য দেখায়। সর্বশেষ প্রকাশিত তথ্য দেখতে আবার সংযুক্ত হোন।', home: 'হোম' },
  ht: { lang: 'ht', dir: 'ltr', title: 'San koneksyon', h1: 'Ou pa konekte', intro: 'Paj sa a pa anrejistre sou aparèy sa a. Paj ou te louvri dènyèman yo toujou disponib:', none: 'Poko gen okenn paj ki anrejistre sou aparèy sa a. Paj ou louvri pandan w konekte yo ap disponib isit la pwochen fwa.', note: 'Paj ki anrejistre yo montre done yo jan yo te ye dènye fwa ou te louvri yo. Rekonekte pou w wè dènye done ki pibliye yo.', home: 'Akèy' },
  ko: { lang: 'ko', dir: 'ltr', title: '오프라인', h1: '오프라인 상태입니다', intro: '이 페이지는 이 기기에 저장되어 있지 않습니다. 최근에 연 페이지는 계속 볼 수 있습니다:', none: '이 기기에 아직 저장된 페이지가 없습니다. 인터넷에 연결된 상태에서 연 페이지는 다음에 여기에서 볼 수 있습니다.', note: '저장된 페이지는 마지막으로 열었을 때의 데이터를 보여 줍니다. 최신 게시 데이터를 보려면 다시 연결하십시오.', home: '홈' },
  ar: { lang: 'ar', dir: 'rtl', title: 'غير متصل', h1: 'أنت غير متصل بالإنترنت', intro: 'هذه الصفحة غير محفوظة على هذا الجهاز. لا تزال الصفحات التي فتحتها مؤخرًا متاحة:', none: 'لا توجد صفحات محفوظة على هذا الجهاز بعد. ستكون الصفحات التي تفتحها أثناء الاتصال بالإنترنت متاحة هنا في المرة القادمة.', note: 'تعرض الصفحات المحفوظة البيانات كما كانت عند آخر مرة فتحتها فيها. أعد الاتصال للاطلاع على أحدث البيانات المنشورة.', home: 'الصفحة الرئيسية' },
  ur: { lang: 'ur', dir: 'rtl', title: 'آف لائن', h1: 'آپ آف لائن ہیں', intro: 'یہ صفحہ اس آلے پر محفوظ نہیں ہے۔ آپ کے حال ہی میں کھولے گئے صفحات اب بھی دستیاب ہیں:', none: 'اس آلے پر ابھی کوئی صفحہ محفوظ نہیں ہے۔ انٹرنیٹ سے منسلک ہونے کے دوران آپ جو صفحات کھولیں گے وہ اگلی بار یہاں دستیاب ہوں گے۔', note: 'محفوظ صفحات وہ ڈیٹا دکھاتے ہیں جو آپ کے آخری بار کھولنے کے وقت تھا۔ تازہ ترین شائع شدہ ڈیٹا دیکھنے کے لیے دوبارہ منسلک ہوں۔', home: 'ہوم' },
  fr: { lang: 'fr', dir: 'ltr', title: 'Hors ligne', h1: 'Vous êtes hors ligne', intro: "Cette page n'est pas enregistrée sur cet appareil. Les pages que vous avez ouvertes récemment restent disponibles :", none: "Aucune page n'est encore enregistrée sur cet appareil. Les pages que vous ouvrez en ligne seront disponibles ici la prochaine fois.", note: "Les pages enregistrées affichent les données telles qu'elles étaient lors de votre dernière consultation. Reconnectez-vous pour obtenir les dernières données publiées.", home: 'Accueil' },
  pl: { lang: 'pl', dir: 'ltr', title: 'Brak połączenia', h1: 'Brak połączenia z internetem', intro: 'Ta strona nie jest zapisana na tym urządzeniu. Strony otwierane ostatnio są nadal dostępne:', none: 'Na tym urządzeniu nie ma jeszcze zapisanych stron. Strony otwarte przy połączeniu z internetem będą tu dostępne następnym razem.', note: 'Zapisane strony pokazują dane z chwili ostatniego otwarcia. Połącz się z internetem, aby zobaczyć najnowsze opublikowane dane.', home: 'Strona główna' },
};

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The offline fallback, rendered here rather than precached from the app:
 * an app page needs its JavaScript chunks to hydrate, and a page that was
 * never opened has none cached. Plain HTML cannot fail that way.
 */
async function offlinePage(pageCaches, request) {
  // The language of the page that could not load (/es/nyc → Spanish).
  const prefix = (new URL(request.url).pathname.split('/')[1] || '').toLowerCase();
  const t = OFFLINE[prefix] || OFFLINE.en;
  const keys = (await Promise.all(pageCaches.map((c) => c.keys()))).flat();
  const saved = [
    ...new Set(
      keys
        .map((r) => new URL(pageKey(r.url)))
        .filter((u) => u.origin === self.location.origin)
        .map((u) => u.pathname + u.search),
    ),
  ].sort();
  const items = saved.length
    ? `<ul dir="ltr">${saved.map((p) => `<li><a href="${escapeHtml(p)}">${escapeHtml(p === '/' ? t.home : p)}</a></li>`).join('')}</ul>`
    : `<p class="muted">${t.none}</p>`;
  const html = `<!doctype html><html lang="${t.lang}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title} · deep-fryer</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#fafaf7;max-width:36rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.5rem;margin:.5rem 0}.muted{color:#6b7280}a{color:#1a1a1a}li{margin:.25rem 0}</style></head><body><main id="main"><div aria-hidden="true" style="font-size:2.5rem">🍩</div><h1>${t.h1}</h1><p class="muted">${t.intro}</p>${items}<p class="muted" style="font-size:.8rem;margin-top:2rem">${t.note}</p></main></body></html>`;
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
