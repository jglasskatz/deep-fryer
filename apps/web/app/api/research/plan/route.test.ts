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
