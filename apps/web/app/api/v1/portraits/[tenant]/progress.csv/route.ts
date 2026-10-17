import { publicTenant } from '@/lib/data';
import { progressCsv, tenantProgress } from '@/lib/progress';
import { publicPortraitSampleData } from '@/lib/sample-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/portraits/{tenant}/progress.csv — one row per published indicator.
 * Public portraits only, whoever calls: see progress.json. Each row's
 * `sample_data` column says whether the values are synthetic, as progress.json
 * does once at the top.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const p = (await publicTenant(tenant)) ? await tenantProgress(tenant) : null;
  if (!p) return new Response('unknown portrait\n', { status: 404 });
  const sampleData = await publicPortraitSampleData(tenant);
  return new Response(progressCsv(p, { sampleData }), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tenant}-progress-${new Date().toISOString().slice(0, 10)}.csv"`,
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
