import { NextResponse } from 'next/server';
import { adminTenant } from '@/lib/admin-data';
import { getRole, roleAtLeast } from '@/lib/auth';
import { getPolicyAnalysisStatus } from '@/lib/policy';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * GET /{tenant}/admin/policy/{id}/status — `{ status }` of one analysis, for
 * the result page's live status line (components/policy/AnalysisStatus.tsx),
 * which re-renders the page only when this changes. Same gate as the page
 * (editor), and the read itself runs under row-level security. It lives
 * under /admin/, which the service worker never caches, so a poll always
 * reaches the server or fails visibly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const { tenant: slug, id } = await params;
  const tenant = await adminTenant(slug);
  if (!tenant) return json({ error: 'unknown portrait' }, 404);
  if (!roleAtLeast(await getRole(tenant.id), 'editor')) {
    return json({ error: 'requires an editor or owner of this portrait' }, 403);
  }
  const row = await getPolicyAnalysisStatus(tenant.id, id);
  if (!row) return json({ error: 'unknown analysis' }, 404);
  return json({ status: row.status });
}
