import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Every server action that needs a signed-in person refuses someone signed
 * out with its not-signed-in answer, whatever the request carries: never a
 * validation message, and never after reading anything but the portrait or
 * organization the request names (the role it needs is a role there).
 *
 * The session is real lib/auth.ts reading an absent Auth.js session; any
 * other database use fails loudly, so an action that validated or looked
 * something up before refusing would answer with that instead.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const touched = vi.hoisted(() => ({ uses: [] as string[] }));
const untouchable = vi.hoisted(
  () =>
    new Proxy({}, {
      get(_, key) {
        touched.uses.push(String(key));
        throw new Error(`database used before the caller was refused (${String(key)})`);
      },
    }),
);
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  getDb: () => untouchable,
  tenantBySlug: vi.fn(async () => ({ id: 'tenant-1', slug: 'somewhere', organizationId: 'org-1', archivedAt: null })),
  organizationBySlug: vi.fn(async () => ({ id: 'org-1', slug: 'somewhere', name: 'Somewhere' })),
}));
vi.mock('@/lib/db', () => ({
  userDb: (fn: (db: unknown) => unknown) => fn(untouchable),
  systemDb: () => untouchable,
  systemTransaction: (fn: (db: unknown) => unknown) => fn(untouchable),
}));

/** Actions meant to work without signing in (lib/involvement-actions.ts, lib/translation-requests.ts). */
const PUBLIC = new Set(['submitInvolvement', 'requestTranslation']);

/** The answers that mean "sign in" or "not with the role this needs". */
const NOT_SIGNED_IN = [
  /^Sign in to (continue|start a portrait|accept this invitation)\.$/,
  /^This needs the (viewer|moderator|editor|owner) role on this portrait\.$/,
  /^This needs an organization owner or billing role\.$/,
  /^Only an organization owner can add, replace, or remove its Anthropic API key\.$/,
  /^Only deep-fryer staff can set contract terms\.$/,
];

/** Wrong in every field an action reads: lists that are not lists, oversized ones, the wrong types. */
const malformed = {
  tenantSlug: 'somewhere',
  orgSlug: 'somewhere',
  body: '',
  vote: 7,
  role: 'emperor',
  dimensionIds: Array.from({ length: 5000 }, () => 'not-an-id'),
  versionIds: 'not a list',
  spotChecked: 42,
  expectedAuditIds: null,
  origins: 'not a list',
  indicatorNames: Array.from({ length: 5000 }, () => ''),
  reviewerNotes: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`d${i}`, 1])),
  data: { indicators: Array.from({ length: 5000 }, () => null) },
  value: Array.from({ length: 5000 }, () => null),
  key: 'threshold_overrides',
  hazard: [],
  plan: 1,
  resource: 'x',
  listing: null,
  config: 'x',
  id: 'not-a-uuid',
  runId: 'not-a-uuid',
  confirm: 3,
  token: {},
  title: '',
  brief: '',
};

const libDir = import.meta.dirname;
const actionModules = readdirSync(libDir)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .filter((file) => readFileSync(path.join(libDir, file), 'utf8').startsWith("'use server';"));

describe('server actions refuse someone signed out before reading the request', () => {
  const saved = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = 'signed-out-actions-test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  it('finds the server action modules', () => {
    expect(actionModules).toContain('actions.ts');
    expect(actionModules).toContain('research-actions.ts');
    expect(actionModules.length).toBeGreaterThanOrEqual(19);
  });

  it.each(actionModules)('%s', async (file) => {
    const mod = (await import(/* @vite-ignore */ path.join(libDir, file))) as Record<string, unknown>;
    const actions = Object.entries(mod).filter(([name, value]) => typeof value === 'function' && !PUBLIC.has(name));
    if (file === 'involvement-actions.ts' || file === 'translation-request-actions.ts') {
      expect(actions).toEqual([]);
      return;
    }
    expect(actions.length).toBeGreaterThan(0);
    for (const [name, fn] of actions) {
      touched.uses.length = 0;
      const result = (await (fn as (...args: unknown[]) => Promise<unknown>)(malformed, malformed)) as
        | { ok: true }
        | { ok: false; error: string };
      expect(result.ok, name).toBe(false);
      const error = (result as { error: string }).error;
      expect(NOT_SIGNED_IN.some((answer) => answer.test(error)), `${name}: ${error}`).toBe(true);
      expect(touched.uses, name).toEqual([]);
    }
  });

  it('leaves the public actions public', async () => {
    const involvement = await import('./involvement-actions');
    const translation = await import('./translation-request-actions');
    expect(typeof involvement.submitInvolvement).toBe('function');
    expect(typeof translation.requestTranslation).toBe('function');
  });
});
