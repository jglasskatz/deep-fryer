import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * public/sw.js and images. Images are served stale-while-revalidate and kept
 * on the device for offline reading — but only images a signed-out public
 * page showed. A staff page's images (the review queue's evidence of
 * findings not yet published, on a shared municipal computer) and anything
 * shown while someone is signed in are never stored. The real worker runs
 * in a VM with a fake Cache Storage, fetch and clients, as in
 * sw-save-offline.test.ts.
 */
const ORIGIN = 'https://app.example.gov';

interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  headers: Headers;
  clone(): FakeResponse;
}

function loadWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, FakeResponse>>();
  const keyOf = (key: string | { url: string }) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (key: string | { url: string }, res: FakeResponse) => void store.set(keyOf(key), res),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (key: string | { url: string }) => store.delete(keyOf(key)),
        match: async (key: string | { url: string }) => store.get(keyOf(key)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  /** What the server marks pages with: `public` signed out, `private` while someone is signed in. */
  let marker: 'public' | 'private' = 'public';
  const fetch = async (input: string | { url: string }): Promise<FakeResponse> => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    const image = url.pathname.startsWith('/files/');
    const response: FakeResponse = {
      ok: true,
      status: 200,
      type: 'basic',
      redirected: false,
      headers: new Headers(image ? {} : { 'x-df-cache': marker, date: new Date().toUTCString() }),
      clone: () => ({ ...response }),
    };
    return response;
  };
  /** The documents (clients) image requests come from, by id. */
  const clients = new Map<string, { url: string }>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, get: async (id: string) => clients.get(id) },
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

  let nextClient = 0;
  /** A page `pagePath` showing image `src`; resolves once the worker has answered (and stored, if it does). */
  async function image(pagePath: string, src: string, { withClient = true } = {}) {
    const clientId = withClient ? `c${++nextClient}` : '';
    if (withClient) clients.set(clientId, { url: new URL(pagePath, ORIGIN).href });
    let answer: Promise<unknown> | undefined;
    listeners.fetch!({
      clientId,
      request: {
        method: 'GET',
        url: new URL(src, ORIGIN).href,
        mode: 'no-cors',
        destination: 'image',
        referrer: new URL(pagePath, ORIGIN).href,
        headers: new Headers(),
      },
      respondWith: (p: Promise<unknown>) => (answer = p),
    });
    await answer;
    // The store happens beside the answer; let it settle.
    await new Promise((r) => setTimeout(r, 0));
  }
  async function navigate(path: string) {
    let answer: Promise<unknown> | undefined;
    listeners.fetch!({
      request: { method: 'GET', url: new URL(path, ORIGIN).href, mode: 'navigate', destination: 'document', headers: new Headers() },
      respondWith: (p: Promise<unknown>) => (answer = p),
    });
    await answer;
  }
  const storedImages = () => {
    const name = [...stores.keys()].find((k) => k.startsWith('df-images-'));
    return [...(stores.get(name ?? '')?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
  };
  return { image, navigate, storedImages, signIn: () => (marker = 'private'), signOut: () => (marker = 'public') };
}

describe('the service worker and images', () => {
  it('keeps an image a signed-out public page showed, for offline reading', async () => {
    const sw = loadWorker();
    await sw.navigate('/nyc');
    await sw.image('/nyc', '/files/df-nyc/snap/published.png');
    expect(sw.storedImages()).toEqual(['/files/df-nyc/snap/published.png']);
  });

  it('never stores an image a staff, account or billing page showed — a draft’s evidence included', async () => {
    const sw = loadWorker();
    await sw.image('/draftcity/admin/review?run=r1', '/files/df-draftcity/snap/draft.png');
    await sw.image('/draftcity/admin/draft', '/files/df-draftcity/snap/draft-2.png');
    await sw.image('/o/draftcity-org/billing', '/files/df-draftcity/logo.png');
    await sw.image('/account', '/files/avatar.png');
    // Without a client the referrer says where the image was shown.
    await sw.image('/draftcity/admin/review', '/files/df-draftcity/snap/draft-3.png', { withClient: false });
    expect(sw.storedImages()).toEqual([]);
  });

  it('stores no image while someone is signed in, even on a public page, and does again once they sign out', async () => {
    const sw = loadWorker();
    sw.signIn();
    await sw.navigate('/nyc');
    await sw.image('/nyc', '/files/df-nyc/snap/a.png');
    expect(sw.storedImages()).toEqual([]);
    sw.signOut();
    await sw.navigate('/nyc');
    await sw.image('/nyc', '/files/df-nyc/snap/a.png');
    expect(sw.storedImages()).toEqual(['/files/df-nyc/snap/a.png']);
  });
});
