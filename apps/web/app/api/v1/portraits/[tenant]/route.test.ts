import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedPortrait } from '@/lib/portrait';

/**
 * The open-data API says at its top level whether a portrait's values are
 * sample data (`sample_data`, core SAMPLE_DATA_CONFIG_KEY), on the portrait
 * and its progress.json alike, so a dataset pulled from a demo stack cannot
 * pass for research. The reads are stubbed: which portraits are public and
 * marked is tested against the database (lib/data.test.ts,
 * lib/sample-data.test.ts).
 */

let sample = false;
const portrait: PublishedPortrait = {
  tenant: { slug: 'ithaca', name: 'City of Ithaca', region: 'NY, USA', population: 32000, description: null, branding: null },
  dimensions: [],
};
vi.mock('@/lib/data', () => ({
  getPublicPortrait: vi.fn(async (slug: string) => (slug === 'ithaca' ? portrait : null)),
  publicTenant: vi.fn(async (slug: string) => (slug === 'ithaca' ? { id: 't1', slug } : null)),
}));
vi.mock('@/lib/sample-data', () => ({ publicPortraitSampleData: vi.fn(async () => sample) }));
vi.mock('@/lib/progress', () => ({
  tenantProgress: vi.fn(async () => ({
    tenant: { slug: 'ithaca', name: 'City of Ithaca' },
    config: { baseline_label: '2025' },
    rows: [],
    gaps: [],
  })),
}));

const params = (tenant: string) => ({ params: Promise.resolve({ tenant }) });

describe('the open-data API’s sample_data flag', () => {
  beforeEach(() => {
    sample = false;
  });

  it('is on the portrait, true for a seeded one and false otherwise', async () => {
    const { GET } = await import('./route');
    let body = await (await GET(new Request('http://x/api/v1/portraits/ithaca'), params('ithaca'))).json();
    expect(body).toMatchObject({ schema: 'deep-fryer.portrait/v1', sample_data: false, tenant: { slug: 'ithaca' } });
    sample = true;
    body = await (await GET(new Request('http://x/api/v1/portraits/ithaca'), params('ithaca'))).json();
    expect(body.sample_data).toBe(true);
  });

  it('is on progress.json too', async () => {
    const { GET } = await import('./progress.json/route');
    sample = true;
    const body = await (await GET(new Request('http://x/api/v1/portraits/ithaca/progress.json'), params('ithaca'))).json();
    expect(body).toMatchObject({ schema: 'deep-fryer.progress/v1', sample_data: true });
  });

  it('leaves a 404 for an unknown or private portrait unchanged', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x/api/v1/portraits/nowhere'), params('nowhere'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown portrait' });
  });
});
