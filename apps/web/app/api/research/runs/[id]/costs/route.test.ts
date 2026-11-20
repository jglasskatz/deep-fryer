import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summarizeRunCosts } from '@deep-fryer/core';
const id = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ data: vi.fn(), role: vi.fn(), labels: vi.fn() }));
vi.mock('@/lib/admin-data', () => ({ runWithSessions: mocks.data }));
vi.mock('@/lib/review-data', () => ({ runDimensionLabels: mocks.labels }));
vi.mock('@/lib/auth', () => ({ getRole: mocks.role, roleAtLeast: (role: string | null) => role !== null }));

describe('research costs export', () => {
  beforeEach(() => {
    mocks.data.mockReset();
    mocks.role.mockReset().mockResolvedValue('viewer');
    mocks.labels.mockReset().mockResolvedValue({ slugById: new Map(), nameBySlug: new Map() });
  });
  const request = (format = '') => new Request(`https://example.org/api/research/runs/${id}/costs${format}`);
  const params = { params: Promise.resolve({ id }) };
  it('keeps missing metering unknown and private', async () => {
    mocks.data.mockResolvedValue({ run: { tenantId: 'tenant', tokenUsage: null }, sessions: [{ id: 's1', kind: 'dimension', dimensionId: null }], findings: [] });
    const { GET } = await import('./route');
    const response = await GET(request(), params);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ coverage: 'unavailable', estimated_usd: null, known_estimated_usd: null, missing_sessions: ['s1'] });
  });
  it('never exports another tenant’s run or a malformed identifier', async () => {
    const { GET } = await import('./route');
    mocks.data.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    mocks.data.mockResolvedValue({ run: { tenantId: 'other' }, sessions: [], findings: [] });
    mocks.role.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(403);
    mocks.data.mockClear();
    expect((await GET(request(), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(404);
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it('exports a quoted, spreadsheet-safe CSV with explicit incomplete accounting', async () => {
    mocks.data.mockResolvedValue({ run: { tenantId: 'tenant', tokenUsage: { '=1+1': { input_tokens: 10, output_tokens: 2 } } }, sessions: [{ id: 's1', kind: 'dimension', dimensionId: null }], findings: [] });
    const { GET } = await import('./route');
    const response = await GET(request('?format=csv'), params);
    const csv = await response.text();
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"partial"');
    expect(csv).toContain('No usage recorded for this session.');
    expect(response.headers.get('content-type')).toContain('text/csv');
  });

  it('exports the same stage, dimension and per-verified-finding figures the run page shows', async () => {
    mocks.data.mockResolvedValue(breakdownRun(priced));
    mocks.labels.mockResolvedValue(labels);
    const { GET } = await import('./route');
    const rows = parse(await (await GET(request('?format=csv'), params)).text());
    const header = rows[0]!;
    const col = (name: string) => header.indexOf(name);
    const pick = (row: string, dimension = '') => rows.find((r) => r[col('row')] === row && (!dimension || r[col('dimension')] === dimension))!;
    const summary = summarizeRunCosts(priced, { sessions: breakdownSessions, findings: breakdownFindings });
    expect(pick('dimension', 'Food')[col('known_estimated_usd')]).toBe(String(round(summary.dimensions[0]!.known_estimated_usd)));
    expect(pick('dimension', 'Food')[col('cost_per_verified_finding_usd')]).toBe(String(round(summary.dimensions[0]!.cost_per_verified_finding_usd!)));
    expect(pick('dimension', 'Housing')[col('verified_findings')]).toBe('0');
    expect(pick('dimension', 'Housing')[col('cost_per_verified_finding_usd')]).toBe('');
    expect(pick('dimension', 'Housing')[col('limitations')]).toBe('No verified findings');
    expect(rows.filter((r) => r[col('row')] === 'stage').map((r) => r[col('stage')])).toEqual(['Region context', 'Research', 'Independent verification', 'Machine audits']);
    const parts = rows.filter((r) => r[col('row')] === 'dimension').reduce((n, r) => n + Number(r[col('known_estimated_usd')]), 0);
    expect(parts).toBeCloseTo(Number(pick('total')[col('known_estimated_usd')]), 5);
    expect(pick('total')[col('coverage')]).toBe('complete');
    expect(pick('total')[col('verified_findings')]).toBe('1');
  });

  it('exports a known subtotal and no cost per verified finding when a model is unpriced', async () => {
    const unpriced = { ...priced, a: { input_tokens: 10, output_tokens: 5, by_model: { 'unknown-model': { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } } } };
    mocks.data.mockResolvedValue(breakdownRun(unpriced));
    mocks.labels.mockResolvedValue(labels);
    const { GET } = await import('./route');
    const rows = parse(await (await GET(request('?format=csv'), params)).text());
    const header = rows[0]!;
    const col = (name: string) => header.indexOf(name);
    const total = rows.find((r) => r[col('row')] === 'total')!;
    expect(total[col('coverage')]).toBe('partial');
    expect(Number(total[col('known_estimated_usd')])).toBeCloseTo(0.0245 * 4, 6);
    expect(total[col('cost_per_verified_finding_usd')]).toBe('');
    expect(total[col('limitations')]).toContain('Cost per verified finding: Not known');
    const food = rows.find((r) => r[col('row')] === 'dimension' && r[col('dimension')] === 'Food')!;
    expect(food[col('coverage')]).toBe('partial');
    expect(food[col('cost_per_verified_finding_usd')]).toBe('');
  });
});

const sonnet = { input_tokens: 1000, output_tokens: 100, by_model: { 'claude-sonnet-5': { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 5000, cache_write_tokens: 200, web_search_requests: 2 } } };
const priced = { r: sonnet, a: sonnet, 'verifier:a': sonnet, b: sonnet, 'audit:workflow:fb': sonnet };
const breakdownSessions = [
  { id: 'r', kind: 'region_context', dimensionId: null },
  { id: 'a', kind: 'dimension', dimensionId: 'dim-a' },
  { id: 'b', kind: 'dimension', dimensionId: 'dim-b' },
];
const breakdownFindings = [
  { id: 'fa', dimensionId: 'dim-a', payload: { kind: 'indicator' }, verification: { content_supported: 'pass' as const } },
  { id: 'fb', dimensionId: 'dim-b', payload: { kind: 'indicator' }, verification: { content_supported: 'fail' as const } },
];
const breakdownRun = (tokenUsage: object) => ({ run: { tenantId: 'tenant', tokenUsage }, sessions: breakdownSessions, findings: breakdownFindings });
const labels = { slugById: new Map([['dim-a', 'food'], ['dim-b', 'housing']]), nameBySlug: new Map([['food', 'Food'], ['housing', 'Housing']]) };
const round = (n: number) => Math.round(n * 1e6) / 1e6;
/** Every cell this route writes is quoted, with "" for a quote inside. */
function parse(csv: string): string[][] {
  return csv.trim().split('\r\n').map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replace(/""/g, '"')));
}
