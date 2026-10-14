import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { dimensionSlugMap, runWithSessions } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { applyResearchAction } from '@/lib/research-actions';
import { ActionButton } from '@/components/admin/ActionButton';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; runId: string }>;
}) {
  const { tenant, runId } = await params;
  const ctx = await requireAdminPage(tenant, 'editor');

  const data = await runWithSessions(runId);
  if (!data || data.run.tenantId !== ctx.tenant.id) notFound();
  const { run, sessions, findings } = data;

  const slugById = await dimensionSlugMap(ctx.tenant.id);
  const sessionBySlug = new Map(
    sessions.map((s) => [
      s.kind === 'region_context' ? 'region_context' : (slugById.get(s.dimensionId ?? '') ?? ''),
      s,
    ]),
  );

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin/research`}>
            ← Research runs
          </Link>
        </p>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            Run {run.id.slice(0, 8)}
            <span className="ml-3 align-middle text-sm font-normal">
              {run.status} · plugin v{run.plan.plugin_version} · config {run.plan.config_hash}
            </span>
          </h1>
          {run.status === 'planned' ? (
            <ActionButton
              action={applyResearchAction.bind(null, { tenantSlug: tenant, runId })}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              pendingLabel="Starting…"
            >
              Apply — start {run.plan.sessions.length} sessions
            </ActionButton>
          ) : run.status === 'complete' ? (
            <Link
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
              href={`/${tenant}/admin/review?run=${run.id}`}
            >
              Review findings ({findings.length})
            </Link>
          ) : null}
        </div>

        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          The plan below is exactly what will run — every prompt rendered from plugin skills +
          portrait config at plan time, inspectable before any tokens are spent. The region brief
          placeholder is filled by the phase-0 session at apply time.
        </p>

        <section className="mt-6 space-y-3">
          {run.plan.sessions.map((spec, i) => {
            const session = sessionBySlug.get(
              spec.kind === 'region_context' ? 'region_context' : (spec.dimension_slug ?? ''),
            );
            return (
              <details key={i} className="rounded border border-black/15 p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">
                    {spec.kind === 'region_context'
                      ? 'Phase 0 — region context'
                      : `Dimension — ${spec.dimension_slug}`}
                  </span>
                  <span className="ml-3 text-xs text-[color:var(--color-muted)]">
                    tools: {spec.tool_allowlist.join(', ')} · output: {spec.output_schema_ref}
                    {session ? ` · ${session.status}` : ''}
                  </span>
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-3 text-xs">
                  {spec.prompt}
                </pre>
              </details>
            );
          })}
        </section>

        {run.tokenUsage ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Metering</h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-[color:var(--color-muted)]">
                  <th className="py-1 pr-4">Session</th>
                  <th className="py-1 pr-4">Input tokens</th>
                  <th className="py-1 pr-4">Output tokens</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(run.tokenUsage).map(([key, u]) => (
                  <tr key={key} className="border-b">
                    <td className="py-1 pr-4 font-mono text-xs">{key.slice(0, 20)}</td>
                    <td className="py-1 pr-4">{u.input_tokens.toLocaleString()}</td>
                    <td className="py-1 pr-4">{u.output_tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </>
  );
}
