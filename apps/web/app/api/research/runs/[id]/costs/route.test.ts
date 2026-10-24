import { beforeEach, describe, expect, it, vi } from 'vitest';
const id = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ data: vi.fn(), role: vi.fn() }));
vi.mock('@/lib/admin-data', () => ({ runWithSessions: mocks.data }));
vi.mock('@/lib/auth', () => ({ getRole: mocks.role, roleAtLeast: (role: string | null) => role !== null }));

describe('research costs export', () => {
  beforeEach(() => {
    mocks.data.mockReset();
    mocks.role.mockReset().mockResolvedValue('viewer');
  });
  const request = (format = '') => new Request(`https://example.org/api/research/runs/${id}/costs${format}`);
  const params = { params: Promise.resolve({ id }) };
  it('keeps missing metering unknown and private', async () => {
    mocks.data.mockResolvedValue({ run: { tenantId: 'tenant', tokenUsage: null }, sessions: [{ id: 's1' }] });
    const { GET } = await import('./route');
    const response = await GET(request(), params);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ coverage: 'unavailable', estimated_usd: null, known_estimated_usd: null, missing_sessions: ['s1'] });
  });
  it('never exports another tenant’s run or a malformed identifier', async () => {
    const { GET } = await import('./route');
    mocks.data.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    mocks.data.mockResolvedValue({ run: { tenantId: 'other' }, sessions: [] });
    mocks.role.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(403);
    mocks.data.mockClear();
    expect((await GET(request(), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(404);
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it('exports a quoted, spreadsheet-safe CSV with explicit incomplete accounting', async () => {
    mocks.data.mockResolvedValue({ run: { tenantId: 'tenant', tokenUsage: { '=1+1': { input_tokens: 10, output_tokens: 2 } } }, sessions: [{ id: 's1' }] });
    const { GET } = await import('./route');
    const response = await GET(request('?format=csv'), params);
    const csv = await response.text();
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"partial"');
    expect(csv).toContain('No usage recorded for this session.');
    expect(response.headers.get('content-type')).toContain('text/csv');
  });
});
