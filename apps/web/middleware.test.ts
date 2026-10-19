import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// These tests are about routing, not about which portraits are translated:
// every portrait here has translation on, whatever database the run points
// at (middleware.translation.test.ts covers portraits that have it off).
vi.mock('./lib/translation-policy', () => ({ translationOnFor: async () => true }));
const { middleware } = await import('./middleware');

/**
 * Language routing in middleware (lib/i18n/routing.ts): the URL prefix picks
 * the language, staff pages stay English, a remembered choice redirects only
 * top-level page loads, and a client can never choose the locale header.
 */
const BASE = 'https://app.test';
const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, BASE), { headers });
// NextResponse encodes forwarded request headers as x-middleware-request-*.
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe('middleware language routing', () => {
  it('renders /es/… as the unprefixed page in Spanish and remembers the choice', async () => {
    const res = await middleware(req('/es/nyc/progress?view=1'));
    expect(res.headers.get('x-middleware-rewrite')).toBe(`${BASE}/nyc/progress?view=1`);
    expect(forwarded(res, 'x-df-locale')).toBe('es');
    expect(forwarded(res, 'x-df-path')).toBe('/nyc/progress?view=1');
    expect(res.headers.get('content-language')).toBe('es');
    expect(res.cookies.get('df_lang')?.value).toBe('es');
  });

  it('keeps the language when Next re-runs middleware on the rewrite target', async () => {
    const first = await middleware(req('/es/nyc/progress?view=1'));
    // Next's second pass: the rewritten URL, carrying the headers the first pass set.
    const carried: Record<string, string> = {};
    first.headers.forEach((v, k) => {
      if (k.startsWith('x-middleware-request-')) carried[k.slice('x-middleware-request-'.length)] = v;
    });
    const second = await middleware(req('/nyc/progress?view=1', carried));
    expect(forwarded(second, 'x-df-locale')).toBe('es');
    expect(forwarded(second, 'x-df-path')).toBe('/nyc/progress?view=1');
    expect(second.headers.get('content-language')).toBe('es');
    // A client cannot forge the marker to pick a language at an English URL.
    const forged = await middleware(req('/nyc', { 'x-df-routed': 'guess', 'x-df-locale': 'ar' }));
    expect(forwarded(forged, 'x-df-locale')).toBe('en');
  });

  it('sends a prefixed staff page to its English URL', async () => {
    const res = await middleware(req('/es/nyc/admin/review'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${BASE}/nyc/admin/review`);
  });

  it('never lets a client choose the locale header', async () => {
    const res = await middleware(req('/nyc', { 'x-df-locale': 'ar', 'x-df-path': '/evil' }));
    expect(forwarded(res, 'x-df-locale')).toBe('en');
    expect(forwarded(res, 'x-df-path')).toBe('/nyc');
  });

  it('returns a reader who chose Spanish to Spanish on a top-level page load only', async () => {
    const cookie = 'df_lang=es';
    const page = await middleware(req('/nyc/dim/housing', { cookie, 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' }));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe(`${BASE}/es/nyc/dim/housing`);

    const fetchRes = await middleware(req('/nyc/dim/housing', { cookie, 'sec-fetch-dest': 'empty' }));
    expect(fetchRes.status).toBe(200);
    const api = await middleware(req('/api/v1/portraits/nyc', { cookie, 'sec-fetch-dest': 'document' }));
    expect(api.status).toBe(200);
    const crossSite = await middleware(
      req('/nyc', { cookie, 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }),
    );
    expect(crossSite.status).toBe(200);
  });

  it('?hl=en switches back to English, records it, and cleans the URL', async () => {
    const res = await middleware(req('/nyc/progress?hl=en&view=1', { cookie: 'df_lang=es' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/nyc/progress?view=1`);
    expect(res.cookies.get('df_lang')?.value).toBe('en');
  });

  it('?hl=ko sends the reader to the Korean URL', async () => {
    const res = await middleware(req('/o/nyc/compare?hl=ko'));
    expect(res.headers.get('location')).toBe(`${BASE}/ko/o/nyc/compare`);
  });
});
