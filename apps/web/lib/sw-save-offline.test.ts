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

type Page = { status?: number; cache?: 'public' | 'private'; redirected?: boolean } | 'offline';
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
      headers: new Headers({ 'x-df-cache': page.cache ?? 'public' }),
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
  const saved = () => [...(stores.get('df-saved')?.keys() ?? [])].map((u) => new URL(u).pathname + new URL(u).search).sort();
  return { save, saved, fetched, stores, navigate, ping, activate, pages };
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
