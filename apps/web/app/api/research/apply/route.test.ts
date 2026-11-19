import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runId = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), role: vi.fn(), apply: vi.fn() }));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  tenantBySlug: mocks.tenant,
}));
vi.mock('@/lib/db', () => ({ systemDb: () => ({}) }));
vi.mock('@/lib/auth', () => ({
  getRole: mocks.role,
  roleAtLeast: (role: string | null) => role === 'editor',
}));
vi.mock('@/lib/research', () => ({ applyRun: mocks.apply }));

const request = () =>
  new Request('https://example.org/api/research/apply', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'somewhere', run_id: runId }),
  });

describe('research apply errors', () => {
  beforeEach(() => {
    mocks.tenant.mockReset().mockResolvedValue({ id: 't1' });
    mocks.role.mockReset().mockResolvedValue('editor');
    mocks.apply.mockReset();
  });

  it('answers with what the database said, not the query or its parameters', async () => {
    const cause = Object.assign(new Error('a run is applied only once'), { code: 'P0001', severity: 'ERROR' });
    mocks.apply.mockRejectedValue(
      new DrizzleQueryError('update "research_runs" set "status" = $1 where "id" = $2', ['queued', runId], cause),
    );
    const { POST } = await import('./route');
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'a run is applied only once' });
  });

  it('reports a database that cannot be reached before the role check without the query', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    mocks.tenant.mockRejectedValue(new DrizzleQueryError('select "id" from "tenants" where "slug" = $1', ['somewhere'], refused));
    const { POST } = await import('./route');
    const body = JSON.stringify(await (await POST(request())).json());
    expect(body).toContain('ECONNREFUSED');
    expect(body).not.toMatch(/Failed query|tenants/);
  });
});
