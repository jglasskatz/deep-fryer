import { NextResponse } from 'next/server';
import { getPublicPortrait } from '@/lib/data';
import { appUrl } from '@/lib/env';
import { publicPortraitSampleData } from '@/lib/sample-data';
import { publicApiMetadata, absoluteEvidenceUrl } from '@/lib/public-api-metadata';
import { publicJson, publicOptions } from '@/lib/public-json';

export const dynamic = 'force-dynamic';

const OPEN = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=300, stale-while-revalidate=600',
};

/**
 * GET /api/v1/portraits/{tenant} — the published portrait as open data:
 * exactly what the public page shows (published versions only, through
 * published_doughnut()), with provenance links. Read-only, CORS-open, cached.
 *
 * Read as an anonymous visitor whoever calls (getPublicPortrait): the answer
 * is publicly cacheable, so a member's request for their portrait before it
 * is public (migration 0015) must get the same 404 as everyone else's, not a
 * view a shared cache would then serve to all.
 *
 * `sample_data` is true when the portrait's values were generated to
 * demonstrate the software (core SAMPLE_DATA_CONFIG_KEY,
 * scripts/seed-demo-data.ts), so a dataset pulled from a demo stack says so
 * at its top level instead of passing for research. Always present.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const [portrait, sampleData] = await Promise.all([getPublicPortrait(tenant), publicPortraitSampleData(tenant)]);
  if (!portrait) return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers: { ...OPEN, 'cache-control': 'no-store' } });
  const metadata = await publicApiMetadata(tenant);
  const base = appUrl();
  return publicJson(req,
    {
      schema: 'deep-fryer.portrait/v1',
      generated_at: new Date().toISOString(),
      sample_data: sampleData,
      links: {
        html: `${base}/${tenant}`,
        methodology: `${base}/${tenant}/methodology`,
        progress_csv: `${base}/api/v1/portraits/${tenant}/progress.csv`,
      },
      ...portrait,
      ...metadata,
      dimensions: portrait.dimensions.map((dimension) => ({
        ...dimension,
        data: { ...dimension.data, indicators: dimension.data.indicators.map((indicator) => ({
          ...indicator,
          ...(indicator.evidence ? { evidence: {
            ...indicator.evidence,
            snapshot_url: absoluteEvidenceUrl(tenant, indicator.evidence.snapshot_path),
            pdf_url: absoluteEvidenceUrl(tenant, indicator.evidence.pdf_path),
          } } : {}),
        })) },
      })),
    },
  );
}

export const OPTIONS = publicOptions;
