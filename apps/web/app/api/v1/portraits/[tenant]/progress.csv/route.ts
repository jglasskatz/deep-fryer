import { progressCsv, tenantProgress } from '@/lib/progress';

export const dynamic = 'force-dynamic';

/** GET /api/v1/portraits/{tenant}/progress.csv — one row per published indicator. */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const p = await tenantProgress(tenant);
  if (!p) return new Response('unknown portrait\n', { status: 404 });
  return new Response(progressCsv(p), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tenant}-progress-${new Date().toISOString().slice(0, 10)}.csv"`,
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
