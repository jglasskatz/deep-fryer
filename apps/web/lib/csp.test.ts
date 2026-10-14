import { describe, expect, it } from 'vitest';
import { buildCsp, isOrigin, originOf } from './csp';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildCsp', () => {
  it('denies framing by default and gates scripts on the nonce', () => {
    const csp = buildCsp({ nonce: 'abc', dev: false, frameAncestors: null });
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
    expect(directive(csp, 'script-src')).toBe(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).toContain('upgrade-insecure-requests');
    expect(directive(csp, 'object-src')).toBe(`object-src 'none'`);
  });

  it('lets the embed route be framed by allowlisted origins only', () => {
    const csp = buildCsp({
      nonce: 'n',
      dev: false,
      frameAncestors: ['https://www.nyc.gov', 'https://evil.example/path', "https://x.gov; script-src *"],
    });
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors 'self' https://www.nyc.gov`);
  });

  it('allows the evidence origin for images and eval only in development', () => {
    const csp = buildCsp({ nonce: 'n', dev: true, evidenceOrigin: 'https://cdn.example', frameAncestors: [] });
    expect(directive(csp, 'img-src')).toContain('https://cdn.example');
    expect(directive(csp, 'script-src')).toContain(`'unsafe-eval'`);
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors 'self'`);
  });
});

describe('isOrigin', () => {
  it('accepts bare origins and rejects anything a CSP could be injected through', () => {
    expect(isOrigin('https://www.nyc.gov')).toBe(true);
    expect(isOrigin('http://localhost:8080')).toBe(true);
    expect(isOrigin('https://www.nyc.gov/')).toBe(true);
    expect(isOrigin('https://www.nyc.gov/page')).toBe(false);
    expect(isOrigin('javascript:alert(1)')).toBe(false);
    expect(isOrigin('https://a.gov https://b.gov')).toBe(false);
    expect(isOrigin('*')).toBe(false);
  });

  it('originOf tolerates junk', () => {
    expect(originOf('https://bucket.example/path')).toBe('https://bucket.example');
    expect(originOf('nope')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
