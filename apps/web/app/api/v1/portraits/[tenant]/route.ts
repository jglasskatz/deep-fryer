import { NextResponse } from 'next/server';
import { getPortrait } from '@/lib/data';
import { appUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

const OPEN = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=300, stale-while-revalidate=600',
};

/**
 * GET /api/v1/portraits/{tenant} — the published portrait as open data:
 * exactly what the public page shows (published versions only, through
 * published_doughnut()), with provenance links. Read-only, CORS-open, cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const portrait = await getPortrait(tenant);
  if (!portrait) return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers: OPEN });
  const base = appUrl();
  return NextResponse.json(
    {
      schema: 'deep-fryer.portrait/v1',
      generated_at: new Date().toISOString(),
      links: {
        html: `${base}/${tenant}`,
        methodology: `${base}/${tenant}/methodology`,
        progress_csv: `${base}/api/v1/portraits/${tenant}/progress.csv`,
      },
      ...portrait,
    },
    { headers: OPEN },
  );
}
