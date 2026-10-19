import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireAdminPage — who gets which redirect. A portrait that has never
 * published is invisible to anyone signed out (migration 0015), and that is
 * when its staff follow the worker's emails to a run or a review: they must
 * reach sign-in, and come back to the page the email named, not land on the
 * home page. The tenant lookup, the session and the role are stubbed; the
 * redirect is Next's, which throws, so each case reads where it was sent.
 */
const state = vi.hoisted(() => ({
  tenant: null as { id: string; slug: string; name: string } | null,
  userId: null as string | null,
  devMode: false,
  role: null as string | null,
  lookups: 0,
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock('./env', () => ({ hasDatabase: () => true }));
vi.mock('./admin-data', () => ({
  adminTenant: vi.fn(async () => {
    state.lookups += 1;
    return state.tenant;
  }),
}));
vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  getAuth: vi.fn(async () => ({ userId: state.userId, devMode: state.devMode })),
  getRole: vi.fn(async () => state.role),
}));

async function sentTo(slug: string, min: 'viewer' | 'editor' = 'viewer', path?: string): Promise<string> {
  const { requireAdminPage } = await import('./admin-guard');
  try {
    await requireAdminPage(slug, min, path);
    return 'allowed';
  } catch (err) {
    return (err as Error).message.replace(/^redirect:/, '');
  }
}

describe('requireAdminPage', () => {
  beforeEach(() => {
    Object.assign(state, { tenant: null, userId: null, devMode: false, role: null, lookups: 0 });
  });

  it('sends a signed-out visitor to sign-in, and back to the page asked for, even for a portrait they cannot see yet', async () => {
    // The portrait has never published: as a signed-out visitor, the lookup would find nothing.
    expect(await sentTo('draftcity', 'editor', '/draftcity/admin/review?run=r-1')).toBe(
      `/login?next=${encodeURIComponent('/draftcity/admin/review?run=r-1')}`,
    );
    // Asked before the portrait is looked up at all, so every slug gets the same answer: nothing about which exist.
    expect(state.lookups).toBe(0);
    expect(await sentTo('no-such-place')).toBe(`/login?next=${encodeURIComponent('/no-such-place/admin')}`);
  });

  it('sends a signed-in visitor who cannot see the portrait home, and a member below the role to the public page', async () => {
    state.userId = 'u-1';
    expect(await sentTo('draftcity')).toBe('/');
    state.tenant = { id: 't-1', slug: 'draftcity', name: 'Draft City' };
    state.role = 'viewer';
    expect(await sentTo('draftcity', 'editor')).toBe('/draftcity?admin=forbidden');
    state.role = 'editor';
    expect(await sentTo('draftcity', 'editor')).toBe('allowed');
  });
});
