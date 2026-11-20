import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), role: vi.fn(), plan: vi.fn() }));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  tenantBySlug: mocks.tenant,
}));
vi.mock('@/lib/db', () => ({ userDb: (fn: (db: unknown) => unknown) => fn({}) }));
vi.mock('@/lib/auth', () => ({
  getAuth: async () => ({ userId: 'u1' }),
  getRole: mocks.role,
  roleAtLeast: (role: string | null) => role === 'editor',
}));
vi.mock('@/lib/research', () => ({ createPlannedRun: mocks.plan }));

const request = () =>
  new Request('https://example.org/api/research/plan', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'somewhere' }),
  });

/** A database refusal as the ORM throws it: SQL and parameters in its message, the driver's error as cause. */
function failedQuery(cause: Error) {
  return new DrizzleQueryError('select "id" from "tenants" where "slug" = $1', ['private-note@example.gov'], cause);
}

describe('research plan errors', () => {
  beforeEach(() => {
    mocks.tenant.mockReset().mockResolvedValue({ id: 't1' });
    mocks.role.mockReset().mockResolvedValue('editor');
    mocks.plan.mockReset();
  });

  it('answers with what the database said, not the query or its parameters', async () => {
    mocks.tenant.mockRejectedValue(failedQuery(new Error('new row violates row-level security policy')));
    const { POST } = await import('./route');
    const response = await POST(request());
    expect(response.status).toBe(400);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('row-level security');
    expect(body).not.toMatch(/Failed query|select "id"|private-note@example\.gov/);
  });

  it('keeps a message written for the editor as it is', async () => {
    mocks.plan.mockRejectedValue(new Error('Select at least one dimension.'));
    const { POST } = await import('./route');
    expect(await (await POST(request())).json()).toEqual({ error: 'Select at least one dimension.' });
  });
});

describe('the strategy a plan request names', () => {
  beforeEach(() => {
    mocks.tenant.mockReset().mockResolvedValue({ id: 't1' });
    mocks.role.mockReset().mockResolvedValue('editor');
    mocks.plan.mockReset().mockImplementation(async (input: { strategy?: 'standard' | 'deep' }) => {
      const { planStrategy } = await import('@deep-fryer/research');
      return {
        run: { id: 'r1', status: 'planned', plan: { sessions: [], config_hash: 'h', plugin_version: 'p', ...planStrategy(input.strategy) } },
        sessionCount: 0,
      };
    });
  });
  const named = (strategy: string) =>
    new Request('https://example.org/api/research/plan', { method: 'POST', body: JSON.stringify({ tenant: 'somewhere', strategy }) });

  it('answers with the version, models and caps the plan recorded', async () => {
    const { POST } = await import('./route');
    const body = await (await POST(named('deep'))).json();
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'deep' }));
    expect(body).toMatchObject({
      strategy: 'deep',
      strategy_version: 1,
      models: { session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5', page_reader_model: 'claude-haiku-4-5-20251001' },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
    });
  });

  it('refuses a strategy the registry does not offer, planning nothing', async () => {
    const { POST } = await import('./route');
    for (const strategy of ['fast', 'operator-defaults', 'deep@1']) {
      expect((await POST(named(strategy))).status).toBe(400);
    }
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
