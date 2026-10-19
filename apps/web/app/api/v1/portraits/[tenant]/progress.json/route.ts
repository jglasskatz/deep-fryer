import { NextResponse } from 'next/server';
import { publicTenant } from '@/lib/data';
import { tenantProgress } from '@/lib/progress';
import { publicPortraitSampleData } from '@/lib/sample-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/portraits/{tenant}/progress.json — statuses, series, and gaps.
 * Public portraits only, whoever calls (lib/data.ts publicTenant): the answer
 * is publicly cacheable, so a member's request for their portrait before it
 * is public (migration 0015) gets the same 404 as everyone else's.
 * `sample_data` says whether the values are synthetic, as on the portrait
 * endpoint (`/api/v1/portraits/{tenant}`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const p = (await publicTenant(tenant)) ? await tenantProgress(tenant) : null;
  const sampleData = p ? await publicPortraitSampleData(tenant) : false;
  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=300, stale-while-revalidate=600',
  };
  if (!p) return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers });
  return NextResponse.json(
    {
      schema: 'deep-fryer.progress/v1',
      portrait: { slug: p.tenant.slug, name: p.tenant.name },
      sample_data: sampleData,
      baseline: p.config,
      generated_at: new Date().toISOString(),
      indicators: p.rows.map((r) => ({
        ring: r.ring,
        dimension: r.dimensionSlug,
        dimension_name: r.dimensionName,
        indicator: r.indicator,
        unit: r.unit,
        status: r.status,
        baseline: r.baseline,
        latest: r.current,
        change_since_baseline: r.changeSinceBaseline,
        target: r.target,
        target_year: r.targetYear,
        expected_now: r.expectedNow,
        required_annual_change: r.requiredAnnualChange,
        series: r.series,
        threshold_ref: r.thresholdRef,
        rationale: r.rationale,
        source: r.source,
        source_url: r.sourceUrl,
      })),
      gaps: p.gaps,
    },
    { headers },
  );
}
