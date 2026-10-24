import { summarizeRunCosts } from '@deep-fryer/core';
import { runWithSessions } from '@/lib/admin-data';
import { getRole, roleAtLeast } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const PRIVATE = { 'cache-control': 'private, no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CSV exports may be opened by a spreadsheet: neutralize formula cells. */
function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Member-only accounting. RLS is applied by runWithSessions before any output. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'unknown run' }, { status: 404, headers: PRIVATE });
  const data = await runWithSessions(id);
  if (!data) return Response.json({ error: 'unknown run' }, { status: 404, headers: PRIVATE });
  if (!roleAtLeast(await getRole(data.run.tenantId), 'viewer')) {
    return Response.json({ error: 'requires membership' }, { status: 403, headers: PRIVATE });
  }
  const summary = summarizeRunCosts(data.run.tokenUsage, data.sessions.map((s) => s.id));
  if (new URL(request.url).searchParams.get('format') !== 'csv') {
    return Response.json({ run_id: id, ...summary }, { headers: PRIVATE });
  }
  const rows: (string | number | null)[][] = [
    ['run_id', 'session', 'role', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'known_estimated_usd', 'coverage', 'limitations'],
    ...summary.sessions.map((s) => [id, s.session, s.role, s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens, s.known_estimated_usd, s.coverage, s.limitations.join(' ')]),
    ...summary.missing_sessions.map((session) => [id, session, '', null, null, null, null, null, 'unavailable', 'No usage recorded for this session.']),
    [id, 'TOTAL', '', null, null, null, null, summary.known_estimated_usd, summary.coverage, summary.basis],
  ];
  return new Response(rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', {
    headers: { ...PRIVATE, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="research-costs-${id}.csv"` },
  });
}
