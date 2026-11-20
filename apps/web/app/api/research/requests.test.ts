import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The member-only research routes answer someone signed out before reading
 * anything the request carries, and the plan route's lists have a maximum.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  run: vi.fn(),
  plan: vi.fn(),
  apply: vi.fn(),
  systemDb: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.session }));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  tenantBySlug: mocks.tenant,
}));
vi.mock('@/lib/db', () => ({ userDb: (fn: (db: unknown) => unknown) => fn({}), systemDb: mocks.systemDb }));
vi.mock('@/lib/admin-data', () => ({ runWithSessions: mocks.run }));
vi.mock('@/lib/research', () => ({ createPlannedRun: mocks.plan, applyRun: mocks.apply }));

const post = (url: string, body: string) => new Request(`https://example.org${url}`, { method: 'POST', body });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('member-only research routes', () => {
  const saved = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = 'research-requests-test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.session.mockResolvedValue(null);
    mocks.tenant.mockResolvedValue(null);
  });

  const lookups = () => [mocks.tenant, mocks.run, mocks.plan, mocks.apply, mocks.systemDb].flatMap((m) => m.mock.calls);

  describe('signed out', () => {
    it('plan and apply answer 401 without reading the body', async () => {
      const { POST: plan } = await import('./plan/route');
      const { POST: apply } = await import('./apply/route');
      const bodies = ['{not json', JSON.stringify({ tenant: 7, dimension_ids: ids(100_000), reviewer_notes: 'x' }), JSON.stringify({ run_id: [] })];
      for (const [route, handler] of [['/api/research/plan', plan], ['/api/research/apply', apply]] as const) {
        for (const body of bodies) {
          const request = post(route, body);
          const response = await handler(request);
          expect(response.status, route).toBe(401);
          expect(await response.json()).toEqual({ error: 'requires sign-in' });
          expect(request.bodyUsed, route).toBe(false);
        }
      }
      expect(lookups()).toEqual([]);
    });

    it('run status, costs and transcript answer 401 before looking anything up', async () => {
      const { GET: status } = await import('./runs/[id]/route');
      const { GET: costs } = await import('./runs/[id]/costs/route');
      const { GET: transcript } = await import('./sessions/[id]/transcript/route');
      for (const id of ['not-a-uuid', ids(1)[0]!]) {
        const responses = [
          await status(new Request('https://example.org/api/research/runs/x'), params(id)),
          await costs(new Request('https://example.org/api/research/runs/x/costs?format=csv'), params(id)),
          await transcript(new Request('https://example.org/api/research/sessions/x/transcript'), params(id)),
        ];
        for (const response of responses) {
          expect(response.status).toBe(401);
          expect(await response.json()).toEqual({ error: 'requires sign-in' });
        }
      }
      expect(lookups()).toEqual([]);
    });
  });

  describe('signed in: the plan route reads at most one entry per dimension', () => {
    beforeEach(() => {
      mocks.session.mockResolvedValue({ user: { id: 'u1' } });
    });

    it('takes 200 dimension ids and refuses 201 before looking up the portrait', async () => {
      const { POST } = await import('./plan/route');
      const at = await POST(post('/api/research/plan', JSON.stringify({ tenant: 'somewhere', dimension_ids: ids(200) })));
      expect(at.status).toBe(404);
      expect(mocks.tenant).toHaveBeenCalledTimes(1);

      mocks.tenant.mockClear();
      const over = await POST(post('/api/research/plan', JSON.stringify({ tenant: 'somewhere', dimension_ids: ids(201) })));
      expect(over.status).toBe(400);
      expect(JSON.stringify(await over.json())).toContain('Too big');
      expect(mocks.tenant).not.toHaveBeenCalled();
    });

    it('takes notes for 200 dimensions and refuses 201', async () => {
      const { POST } = await import('./plan/route');
      const notes = (n: number) => Object.fromEntries(ids(n).map((id) => [id, 'look at the county data']));
      const at = await POST(post('/api/research/plan', JSON.stringify({ tenant: 'somewhere', reviewer_notes: notes(200) })));
      expect(at.status).toBe(404);

      mocks.tenant.mockClear();
      const over = await POST(post('/api/research/plan', JSON.stringify({ tenant: 'somewhere', reviewer_notes: notes(201) })));
      expect(over.status).toBe(400);
      expect(JSON.stringify(await over.json())).toContain('Too big');
      expect(mocks.tenant).not.toHaveBeenCalled();
      expect(mocks.plan).not.toHaveBeenCalled();
    });
  });
});
