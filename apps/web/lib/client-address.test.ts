import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressHash, clientAddress } from './client-address';

/**
 * Where a public request came from (for rate limits) and how that is
 * stored: Caddy's X-Forwarded-For first entry wins over X-Real-IP, and the
 * stored value is a stable keyed hash that never contains the address.
 */

describe('clientAddress', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('takes the first X-Forwarded-For entry (the client, as Caddy wrote it)', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.2, 10.0.0.3' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': '2001:db8::1', 'x-real-ip': '198.51.100.9' }))).toBe('2001:db8::1');
  });

  it('falls back to X-Real-IP, then to "unknown"', () => {
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
    expect(clientAddress(headers({ 'x-forwarded-for': ' , ', 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
    expect(clientAddress(headers({}))).toBe('unknown');
  });

  it('bounds what it returns', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': 'x'.repeat(500) }))).toHaveLength(64);
  });
});

describe('addressHash', () => {
  const saved = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = 'address-hash-test-secret';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  it('is stable, 32 hex characters, and never the address itself', () => {
    const hash = addressHash('203.0.113.7');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(addressHash('203.0.113.7')).toBe(hash);
    expect(hash).not.toContain('203');
    expect(addressHash('203.0.113.8')).not.toBe(hash);
  });

  it('counts both spellings of an IPv6 address together', () => {
    expect(addressHash('2001:DB8::1')).toBe(addressHash('2001:db8::1'));
  });

  it('is keyed: another secret gives another hash', () => {
    const hash = addressHash('203.0.113.7');
    process.env.AUTH_SECRET = 'another-secret';
    expect(addressHash('203.0.113.7')).not.toBe(hash);
  });
});
