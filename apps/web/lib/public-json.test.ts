import { describe, expect, it } from 'vitest';
import { publicJson, publicOptions } from './public-json';

describe('anonymous public JSON caching', () => {
  it('returns 304 for unchanged data even when generation time changes', async () => {
    const first = publicJson(new Request('http://x'), { generated_at: '2026-01-01', value: 42 });
    const etag = first.headers.get('etag')!;
    const next = publicJson(new Request('http://x', { headers: { 'If-None-Match': `"older", ${etag}` } }), { generated_at: '2026-01-02', value: 42 });
    expect(next.status).toBe(304);
    expect(await next.text()).toBe('');
    expect(next.headers.get('etag')).toBe(etag);
    expect(next.headers.get('access-control-expose-headers')).toBe('ETag');
  });
  it('invalidates when data, flags, or evidence changes', () => {
    const etag = publicJson(new Request('http://x'), { flags: { emergency: true } }).headers.get('etag')!;
    const next = publicJson(new Request('http://x', { headers: { 'If-None-Match': etag } }), { flags: { emergency: false } });
    expect(next.status).toBe(200);
    expect(next.headers.get('etag')).not.toBe(etag);
  });
  it('supports weak comparison, wildcards, and cross-origin conditional requests', () => {
    const body = { value: 42 };
    const tag = publicJson(new Request('http://x'), body).headers.get('etag')!;
    for (const candidate of [tag.replace(/^W\//, ''), '*']) {
      expect(publicJson(new Request('http://x', { headers: { 'If-None-Match': candidate } }), body).status).toBe(304);
    }
    expect(publicOptions().headers.get('access-control-allow-headers')).toBe('If-None-Match');
  });
});
