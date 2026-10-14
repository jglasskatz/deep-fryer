import { NextResponse } from 'next/server';
import { tenantProgress } from '@/lib/progress';

export const dynamic = 'force-dynamic';

/** GET /api/v1/portraits/{tenant}/progress.json — statuses, series, and gaps. */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const p = await tenantProgress(tenant);
  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=300, stale-while-revalidate=600',
  };
  if (!p) return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers });
  return NextResponse.json(
    {
      schema: 'deep-fryer.progress/v1',
      portrait: { slug: p.tenant.slug, name: p.tenant.name },
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
