import { summarizeRunCosts } from '@deep-fryer/core';
import { runWithSessions } from '@/lib/admin-data';
import { getRole, roleAtLeast } from '@/lib/auth';
import { isSignedIn, SIGN_IN_REQUIRED } from '@/lib/signed-in';
import { runDimensionLabels } from '@/lib/review-data';
import { perVerifiedLabel, STAGE_LABEL } from '@/components/admin/RunCostSummary';
import { executorName, fallbackPairs, providerName, sessionModels } from '@/app/[tenant]/admin/research/provenance';

export const dynamic = 'force-dynamic';
const PRIVATE = { 'cache-control': 'private, no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CSV exports may be opened by a spreadsheet: neutralize formula cells. */
function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Dollars to the millionth: finer than the page shows, without floating-point tails. */
const usd = (value: number | null) => (value === null ? null : Math.round(value * 1e6) / 1e6);

/** Member-only accounting. RLS is applied by runWithSessions before any output. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return Response.json(SIGN_IN_REQUIRED, { status: 401, headers: PRIVATE });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'unknown run' }, { status: 404, headers: PRIVATE });
  const data = await runWithSessions(id);
  if (!data) return Response.json({ error: 'unknown run' }, { status: 404, headers: PRIVATE });
  if (!roleAtLeast(await getRole(data.run.tenantId), 'viewer')) {
    return Response.json({ error: 'requires membership' }, { status: 403, headers: PRIVATE });
  }
  const summary = summarizeRunCosts(data.run.tokenUsage, { sessions: data.sessions, findings: data.findings });
  const execution = data.run.execution ?? null;
  if (new URL(request.url).searchParams.get('format') !== 'csv') {
    return Response.json({ run_id: id, execution, ...summary }, { headers: PRIVATE });
  }
  const { slugById, nameBySlug } = await runDimensionLabels(data.run.tenantId);
  const dimensionName = (dimensionId: string | null) => {
    if (!dimensionId) return '';
    const slug = slugById.get(dimensionId);
    return slug ? (nameBySlug.get(slug) ?? slug) : 'A dimension no longer on this portrait';
  };
  const stageNames = summary.sessions.some((s) => s.role === 'region_context')
    ? (['region_context', 'research', 'verification', 'audit'] as const)
    : (['research', 'verification', 'audit'] as const);
  const stageTotal = { region_context: summary.region_context_estimated_usd, research: summary.research_estimated_usd, verification: summary.verification_estimated_usd, audit: summary.audit_estimated_usd };
  // Where every row's spend went: the run's provider and executor (or "provider not recorded" on an
  // older run), and per session the model that answered and any model that answered after a refusal.
  const where = [providerName(execution), executorName(execution)];
  const modelsOf = (session: string) => {
    const models = sessionModels(data.run.tokenUsage?.[session]);
    return [models?.model ?? null, fallbackPairs(models).map((pair) => pair.to).join(' ') || null];
  };
  // One sheet, one header: each row says what it is in `row`. Session rows
  // add up to the stage rows, and the dimension rows plus region context
  // (and anything not matched to a dimension) add up to the total row.
  const blank = [null, null, null, null] as const;
  const rows: (string | number | null)[][] = [
    ['run_id', 'row', 'session', 'stage', 'dimension', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'known_estimated_usd', 'coverage', 'verified_findings', 'cost_per_verified_finding_usd', 'limitations', 'provider', 'executor', 'model', 'answered_after_refusal_by'],
    ...summary.sessions.map((s) => [id, 'session', s.session, STAGE_LABEL[s.role], dimensionName(s.dimension_id), s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens, usd(s.known_estimated_usd), s.coverage, null, null, s.limitations.join(' '), ...where, ...modelsOf(s.session)]),
    ...summary.missing_sessions.map((session) => [id, 'session', session, '', dimensionName(data.sessions.find((s) => s.id === session)?.dimensionId ?? null), ...blank, null, 'unavailable', null, null, 'No usage recorded for this session.', ...where, null, null]),
    ...(summary.sessions.length ? stageNames.map((stage) => [id, 'stage', '', STAGE_LABEL[stage], '', ...blank, usd(stageTotal[stage]), '', null, null, '', ...where, null, null]) : []),
    ...summary.dimensions.map((d) => [id, 'dimension', '', '', dimensionName(d.dimension_id), ...blank, usd(d.known_estimated_usd), d.coverage, d.verified_findings, usd(d.cost_per_verified_finding_usd), d.cost_per_verified_finding_usd === null ? perVerifiedLabel(d) : '', ...where, null, null]),
    ...(summary.sessions.some((s) => s.role === 'region_context') ? [[id, 'dimension', '', STAGE_LABEL.region_context, 'Shared by every dimension', ...blank, usd(summary.region_context_estimated_usd), '', null, null, '', ...where, null, null]] : []),
    ...(summary.unattributed_estimated_usd !== null ? [[id, 'dimension', '', '', 'Not matched to a dimension', ...blank, usd(summary.unattributed_estimated_usd), '', null, null, '', ...where, null, null]] : []),
    [id, 'total', 'TOTAL', '', '', ...blank, usd(summary.known_estimated_usd), summary.coverage, summary.verified_findings, usd(summary.cost_per_verified_finding_usd),
      [summary.basis, summary.verified_findings !== null && summary.cost_per_verified_finding_usd === null ? `Cost per verified finding: ${perVerifiedLabel(summary)}.` : ''].filter(Boolean).join(' '), ...where, null, null],
  ];
  return new Response(rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', {
    headers: { ...PRIVATE, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="research-costs-${id}.csv"` },
  });
}
