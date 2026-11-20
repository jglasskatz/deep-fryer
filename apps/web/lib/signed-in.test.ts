import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => vi.fn());
vi.mock('@/auth', () => ({ auth: session }));

describe('isSignedIn', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    session.mockReset();
  });

  it('reads the database session when sign-in is configured', async () => {
    vi.stubEnv('AUTH_SECRET', 'signed-in-test');
    const { isSignedIn } = await import('./signed-in');
    session.mockResolvedValue(null);
    expect(await isSignedIn()).toBe(false);
    session.mockResolvedValue({ user: { name: 'no id' } });
    expect(await isSignedIn()).toBe(false);
    session.mockResolvedValue({ user: { id: 'u1' } });
    expect(await isSignedIn()).toBe(true);
  });

  it('acts as the local developer in development without AUTH_SECRET, as getAuth does', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    const { isSignedIn } = await import('./signed-in');
    expect(await isSignedIn()).toBe(true);
    expect(session).not.toHaveBeenCalled();
  });

  it('refuses to answer in production without AUTH_SECRET', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    const { isSignedIn } = await import('./signed-in');
    await expect(isSignedIn()).rejects.toThrow(/AUTH_SECRET/);
  });
});
