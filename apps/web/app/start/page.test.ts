import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * /start is the deployment's self_serve feature (core features.ts): on by
 * default, and with DF_DISABLED_FEATURES=self_serve the page — both steps —
 * does not exist, before it asks anyone to sign in or reads anything.
 * The page is called as Next calls it; what it renders when on is the
 * concern of the actions it uses (lib/org-actions.test.ts,
 * lib/research-actions.test.ts).
 */

// Vitest compiles the page's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

/** Next's notFound() and redirect() throw; the digest says which, and where to. */
async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'rendered';
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (digest.includes('404')) return '404';
    if (digest.startsWith('NEXT_REDIRECT')) return `redirect ${digest.split(';')[2]}`;
    throw err;
  }
}

describe('/start and the self_serve feature', () => {
  const saved = { DF_DISABLED_FEATURES: process.env.DF_DISABLED_FEATURES, DATABASE_URL: process.env.DATABASE_URL };
  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    (await import('@/lib/features')).resetDeploymentDisabledForTests();
  });

  async function visit(searchParams: { portrait?: string; checkout?: string }, disabled: string | undefined) {
    if (disabled === undefined) delete process.env.DF_DISABLED_FEATURES;
    else process.env.DF_DISABLED_FEATURES = disabled;
    (await import('@/lib/features')).resetDeploymentDisabledForTests();
    // No database: the page's first step past the feature guard is to send the visitor home, which is
    // enough to tell "the page exists" from "404" without signing anyone in.
    delete process.env.DATABASE_URL;
    const { default: StartPage } = await import('./page');
    return outcome(StartPage({ searchParams: Promise.resolve(searchParams) }));
  }

  it('is a 404 — both steps — when the deployment turns self-serve start off', async () => {
    expect(await visit({}, 'self_serve')).toBe('404');
    expect(await visit({ portrait: 'ithaca' }, 'self_serve')).toBe('404');
    expect(await visit({ portrait: 'ithaca', checkout: 'success' }, 'deep_fry, self_serve')).toBe('404');
  });

  it('exists by default, and when only other features are off', async () => {
    expect(await visit({}, undefined)).toBe('redirect /');
    expect(await visit({ portrait: 'ithaca' }, 'deep_fry,emergency')).toBe('redirect /');
  });
});
