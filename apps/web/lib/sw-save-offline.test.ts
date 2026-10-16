import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * public/sw.js "save for offline" (SPEC-v5 §3): the emergency page posts
 * { type: 'CACHE_URLS', urls } and the worker must store only what an
 * ordinary visit would — same-origin pages, outside the never-cache list,
 * answered ok and marked `x-df-cache: public` — and say per URL what
 * happened. Saved copies must then outlive app updates and ordinary
 * browsing, and serve the emergency page offline whichever hazard the
 * reader picks. The worker runs here in a VM with a fake Cache Storage and
 * fetch, so the real file is what is tested.
 */

const ORIGIN = 'https://app.example.gov';

interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  headers: Headers;
  /** Which fetch produced it ("/nyc/emergency#2"), to tell copies apart. */
  body: string;
  clone(): FakeResponse;
}

type Page = { status?: number; cache?: 'public' | 'private'; redirected?: boolean; date?: string } | 'offline';
type Key = string | { url: string };
const keyUrl = (key: Key) => (typeof key === 'string' ? new URL(key, ORIGIN).href : key.url);

function loadWorker(pages: Record<string, Page>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, FakeResponse>>();
  const fetched: string[] = [];
  let served = 0;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (key: Key, res: FakeResponse) => void store.set(keyUrl(key), res),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (key: Key) => store.delete(keyUrl(key)),
        match: async (key: Key, options?: { ignoreSearch?: boolean }) => {
          const wanted = new URL(keyUrl(key));
          if (!options?.ignoreSearch) return store.get(wanted.href);
          for (const [url, res] of store) {
            const u = new URL(url);
            if (u.origin === wanted.origin && u.pathname === wanted.pathname) return res;
          }
          return undefined;
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const fetch = async (input: string | { url: string }): Promise<FakeResponse> => {
    const url = typeof input === 'string' ? input : input.url;
    fetched.push(url);
    const page = pages[new URL(url, ORIGIN).pathname];
    if (!page || page === 'offline') throw new TypeError('Failed to fetch');
    const status = page.status ?? 200;
    const response: FakeResponse = {
      ok: status >= 200 && status < 300,
      status,
      type: 'basic',
      redirected: Boolean(page.redirected),
      headers: new Headers({ 'x-df-cache': page.cache ?? 'public', date: page.date ?? new Date().toUTCString() }),
      body: `${new URL(url, ORIGIN).pathname}#${++served}`,
      clone: () => ({ ...response }),
    };
    return response;
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self,
    caches,
    fetch,
    URL,
    Headers,
    Response,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  async function save(urls: unknown) {
    let reply: { type: string; results: { url: string; ok: boolean; reason?: string }[] } | undefined;
    let work: Promise<unknown> = Promise.resolve();
    listeners.message!({
      data: { type: 'CACHE_URLS', urls },
      ports: [{ postMessage: (m: typeof reply) => (reply = m) }],
      waitUntil: (p: Promise<unknown>) => (work = p),
    });
    await work;
    return reply!;
  }
  /** A page navigation, as the browser sends it; resolves to what the worker answered. */
  async function navigate(path: string) {
    let answer: Promise<FakeResponse | Response> | undefined;
    listeners.fetch!({
      request: { method: 'GET', url: new URL(path, ORIGIN).href, mode: 'navigate', destination: 'document', headers: new Headers() },
      respondWith: (p: Promise<FakeResponse | Response>) => (answer = p),
    });
    return answer!;
  }
  /** Any other message the page posts (CACHE_PAGE, CLEAR_PAGES); resolves when the worker is done. */
  async function post(data: unknown) {
    let work: Promise<unknown> = Promise.resolve();
    listeners.message!({ data, ports: [], waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  }
  async function ping() {
    let reply: unknown;
    listeners.message!({ data: { type: 'PING' }, ports: [{ postMessage: (m: unknown) => (reply = m) }], waitUntil: () => undefined });
    return reply;
  }
  async function activate() {
    let work: Promise<unknown> = Promise.resolve();
    listeners.activate!({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  }
  const paths = (name: string) => [...(stores.get(name)?.keys() ?? [])].map((u) => new URL(u).pathname + new URL(u).search).sort();
  const saved = () => paths('df-saved');
  /** What ordinary browsing has stored (the versioned page cache). */
  const visited = () => paths([...stores.keys()].find((k) => k.startsWith('df-pages-')) ?? 'df-pages-none');
  const statics = () => paths([...stores.keys()].find((k) => k.startsWith('df-static-')) ?? 'df-static-none');
  return { save, saved, visited, statics, fetched, stores, navigate, post, ping, activate, pages };
}

describe('service worker: save for offline', () => {
  it('stores public pages and answers for each URL', async () => {
    const sw = loadWorker({ '/es/nyc/emergency': {}, '/es/nyc': {} });
    const reply = await sw.save(['/es/nyc/emergency', '/es/nyc']);
    expect(reply).toEqual({
      type: 'CACHE_URLS_RESULT',
      results: [
        { url: '/es/nyc/emergency', ok: true },
        { url: '/es/nyc', ok: true },
      ],
    });
    expect(sw.saved()).toEqual(['/es/nyc', '/es/nyc/emergency']);
  });

  it('never stores a signed-in page, an error, a redirect, or an unreachable page', async () => {
    const sw = loadWorker({
      '/nyc/emergency': { cache: 'private' },
      '/nyc': { status: 500 },
      '/old': { redirected: true },
      '/gone': 'offline',
    });
    const reply = await sw.save(['/nyc/emergency', '/nyc', '/old', '/gone']);
    expect(reply.results.map((r) => [r.url, r.ok, r.reason])).toEqual([
      ['/nyc/emergency', false, 'private'],
      ['/nyc', false, 'status 500'],
      ['/old', false, 'redirected'],
      ['/gone', false, 'network'],
    ]);
    expect(sw.saved()).toEqual([]);
  });

  it('refuses other origins and staff pages without fetching them', async () => {
    const sw = loadWorker({ '/nyc/admin/emergency': {} });
    const reply = await sw.save(['https://evil.example/nyc', '/nyc/admin/emergency', '/api/v1/portraits/nyc']);
    expect(reply.results.every((r) => !r.ok && r.reason === 'refused')).toBe(true);
    expect(sw.fetched).toEqual([]);
    expect((await sw.save('not a list')).results).toEqual([]);
  });

  it('answers PING, so the page can tell it from an older worker that never replies', async () => {
    const sw = loadWorker({});
    expect(await sw.ping()).toEqual({ type: 'PONG', version: expect.stringMatching(/^v\d+$/) });
  });

  it('keeps saved pages through an app update and through ordinary browsing', async () => {
    const pages: Record<string, Page> = { '/nyc/emergency': {}, '/nyc': {} };
    for (let i = 0; i < 80; i++) pages[`/nyc/dimensions/d${i}`] = {};
    const sw = loadWorker(pages);
    await sw.save(['/nyc/emergency', '/nyc']);
    // Browsing far more pages than the visit cache holds.
    for (let i = 0; i < 80; i++) await sw.navigate(`/nyc/dimensions/d${i}`);
    // An update activates: versioned caches from older workers go, saves stay.
    sw.stores.set('df-pages-v1', new Map());
    await sw.activate();
    expect(sw.stores.has('df-pages-v1')).toBe(false);
    expect(sw.saved()).toEqual(['/nyc', '/nyc/emergency']);
  });

  it('serves the saved emergency page offline, whichever hazard is picked, and refreshes it on visits', async () => {
    const sw = loadWorker({ '/nyc/emergency': {}, '/nyc': {} });
    await sw.save(['/nyc/emergency']);
    // An online visit refreshes the saved copy.
    const visit = (await sw.navigate('/nyc/emergency')) as FakeResponse;
    expect(visit.body).toBe('/nyc/emergency#2');
    sw.pages['/nyc/emergency'] = 'offline';
    const offline = (await sw.navigate('/nyc/emergency')) as FakeResponse;
    expect(offline.body).toBe('/nyc/emergency#2');
    // Picking another hazard offline falls back to Next's full navigation
    // with a new query; any stored copy of the page is better than none.
    const otherHazard = (await sw.navigate('/nyc/emergency?hazard=flooding')) as FakeResponse;
    expect(otherHazard.body).toBe('/nyc/emergency#2');
    // Other pages still need their exact address: the offline notice lists what is stored.
    sw.pages['/nyc'] = 'offline';
    const notice = await sw.navigate('/nyc/compare?with=bronx');
    expect(notice).toBeInstanceOf(Response);
    const html = await (notice as Response).text();
    expect(html).toContain('href="/nyc/emergency"');
  });
});

describe('service worker: pages the app is showing (CACHE_PAGE)', () => {
  const page = (url: string, assets: string[] = []) => ({ type: 'CACHE_PAGE', url, assets });

  it('stores a public page reached by an in-app link, which then opens offline', async () => {
    const sw = loadWorker({ '/manhattan': {}, '/nyc/dim/housing': {} });
    // Next's links load RSC payloads; the app names the page it is showing instead.
    await sw.post(page('/manhattan'));
    await sw.post(page('/nyc/dim/housing'));
    expect(sw.visited()).toEqual(['/manhattan', '/nyc/dim/housing']);
    sw.pages['/manhattan'] = 'offline';
    const offline = (await sw.navigate('/manhattan')) as FakeResponse;
    expect(offline.body).toBe('/manhattan#1');
  });

  it('does not fetch a page it stored moments ago, but refreshes an older copy', async () => {
    const sw = loadWorker({ '/nyc': {}, '/bronx': { date: new Date(Date.now() - 10 * 60 * 1000).toUTCString() } });
    // A document visit stores the page; the app's message on load then changes nothing.
    await sw.navigate('/nyc');
    await sw.post(page('/nyc'));
    expect(sw.fetched.filter((u) => u.endsWith('/nyc'))).toHaveLength(1);
    await sw.post(page('/bronx'));
    await sw.post(page('/bronx'));
    // Stored ten minutes ago by the server's clock: fetched again.
    expect(sw.fetched.filter((u) => u.endsWith('/bronx'))).toHaveLength(2);
  });

  it('never stores a signed-in page, and stops fetching for this while someone is signed in', async () => {
    const sw = loadWorker({ '/nyc': { cache: 'private' }, '/queens': { cache: 'private' } });
    await sw.post(page('/nyc'));
    expect(sw.visited()).toEqual([]);
    // The server said "private": no second render just to be refused.
    await sw.post(page('/queens'));
    expect(sw.fetched.map((u) => new URL(u).pathname)).toEqual(['/nyc']);
    // Signing out clears the marker, and pages are kept again.
    sw.pages['/queens'] = {};
    await sw.post({ type: 'CLEAR_PAGES' });
    await sw.post(page('/queens'));
    expect(sw.visited()).toEqual(['/queens']);
  });

  it('refuses staff pages, other origins and RSC payloads without fetching them', async () => {
    const sw = loadWorker({ '/nyc/admin': {}, '/nyc': {} });
    await sw.post(page('/nyc/admin'));
    await sw.post(page('https://evil.example/nyc'));
    await sw.post(page('/nyc?_rsc=abc'));
    await sw.post(page('/account'));
    expect(sw.fetched).toEqual([]);
  });

  it("stores the first visit's static files it does not have, and only same-origin /_next/static ones", async () => {
    const sw = loadWorker({ '/nyc': {}, '/_next/static/chunks/app.js': {}, '/_next/static/css/app.css': {} });
    await sw.post(
      page('/nyc', ['/_next/static/chunks/app.js', '/_next/static/css/app.css', '/icons/icon.svg', 'https://cdn.example/_next/static/x.js']),
    );
    expect(sw.statics()).toEqual(['/_next/static/chunks/app.js', '/_next/static/css/app.css']);
    sw.fetched.length = 0;
    await sw.post(page('/nyc', ['/_next/static/chunks/app.js']));
    expect(sw.fetched).toEqual([]);
  });
});

describe('service worker: view-only query parameters offline', () => {
  it('serves the stored portrait for a URL that only adds ?dim= (a selection, or Back to it)', async () => {
    const sw = loadWorker({ '/nyc': {} });
    await sw.navigate('/nyc');
    sw.pages['/nyc'] = 'offline';
    const selected = (await sw.navigate('/nyc?dim=housing')) as FakeResponse;
    expect(selected.body).toBe('/nyc#1');
    // Other queries still need their own copy.
    expect(await sw.navigate('/nyc?sort=new')).toBeInstanceOf(Response);
  });

  it("stores and finds the installed app's /?source=pwa launch as the home page", async () => {
    const sw = loadWorker({ '/': {} });
    await sw.navigate('/?source=pwa');
    expect(sw.visited()).toEqual(['/']);
    sw.pages['/'] = 'offline';
    expect(((await sw.navigate('/?source=pwa')) as FakeResponse).body).toBe('/#1');
    expect(((await sw.navigate('/')) as FakeResponse).body).toBe('/#1');
    // And the offline notice lists it as Home, not as a raw address.
    const notice = (await sw.navigate('/nyc')) as Response;
    const html = await notice.text();
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).not.toContain('source=pwa');
  });
});
