import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Language routing when a portrait's `translation` feature is off (SPEC-v7
 * §3.5): its pages are English only, whatever URL or remembered choice a
 * reader arrives with; other portraits and the site's own pages are not
 * affected. The policy itself (which portraits have it on) is tested in
 * lib/translation-policy.test.ts; here it is fixed: "plain" is off.
 */
vi.mock('./lib/translation-policy', () => ({
  translationOnFor: async (path: string) => !path.startsWith('/plain') && !path.startsWith('/embed/plain'),
}));

const { middleware } = await import('./middleware');
const BASE = 'https://app.test';
const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(new URL(path, BASE), { headers });
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const page = { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' };

describe('middleware with translation off for a portrait', () => {
  it('redirects a prefixed URL to the English page, temporarily', async () => {
    const res = await middleware(req('/es/plain/dim/housing?x=1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${BASE}/plain/dim/housing?x=1`);
  });

  it('does not send a reader who chose Spanish to a Spanish URL, and renders English', async () => {
    const res = await middleware(req('/plain', { cookie: 'df_lang=es', ...page }));
    expect(res.status).not.toBe(307);
    expect(forwarded(res, 'x-df-locale')).toBe('en');
    // The choice is kept for portraits that are translated.
    const other = await middleware(req('/nyc', { cookie: 'df_lang=es', ...page }));
    expect(other.headers.get('location')).toBe(`${BASE}/es/nyc`);
  });

  it('remembers ?hl= but keeps the English URL', async () => {
    const res = await middleware(req('/plain/progress?hl=ko'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/plain/progress`);
    expect(res.cookies.get('df_lang')?.value).toBe('ko');
  });

  it('leaves translated portraits and site pages multilingual', async () => {
    const res = await middleware(req('/es/nyc'));
    expect(forwarded(res, 'x-df-locale')).toBe('es');
  });
});
