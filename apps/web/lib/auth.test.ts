import { describe, expect, it, vi } from 'vitest';

// lib/auth.ts reads the session through Auth.js; safeNextPath never does.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

describe('safeNextPath', () => {
  it('follows same-site paths and falls back for anything else', async () => {
    const { safeNextPath } = await import('./auth');
    expect(safeNextPath('/nyc/dim/housing?x=1')).toBe('/nyc/dim/housing?x=1');
    expect(safeNextPath(undefined)).toBe('/account');
    expect(safeNextPath('https://evil.example', '/start')).toBe('/start');
    expect(safeNextPath('//evil.example')).toBe('/account');
    expect(safeNextPath('/\\evil.example')).toBe('/account');
  });

  it('refuses a path that only looks local: browsers drop tabs and newlines and read \\ as /', async () => {
    // `/login?next=/%09/evil.example` reaches the page decoded. Redirected to
    // as is, its Location header would land a signed-in person on evil.example.
    const { safeNextPath } = await import('./auth');
    for (const bad of ['/\t/evil.example/login', '/\n/evil.example', '/\r/evil.example', '/\t\\evil.example']) {
      expect(safeNextPath(bad), JSON.stringify(bad)).toBe('/account');
    }
  });
});
