import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import {
  commentCounts,
  recentAudit,
  stalenessOverview,
  tenantConfigMap,
  tenantDimensions,
  tenantRuns,
} from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'viewer');

  const [dims, config, runs, audit, discussed] = await Promise.all([
    tenantDimensions(ctx.tenant.id),
    tenantConfigMap(ctx.tenant.id),
    tenantRuns(ctx.tenant.id),
    recentAudit(ctx.tenant.id, 10),
    commentCounts(ctx.tenant.id),
  ]);
  const staleness = stalenessOverview(dims, config.recency);
  const staleBySlug = new Map(staleness.map((s) => [s.slug, s]));
  const activeRuns = runs.filter((r) => r.status === 'planned' || r.status === 'running');

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Admin</h1>
          <nav className="flex gap-3 text-sm">
            <Link className="rounded border px-3 py-1.5 hover:bg-black/5" href={`/${tenant}/admin/review`}>
              Review queue{activeRuns.length ? ` (${activeRuns.length} active)` : ''}
            </Link>
            <Link className="rounded border px-3 py-1.5 hover:bg-black/5" href={`/${tenant}/admin/research`}>
              Research runs
            </Link>
            <Link className="rounded border px-3 py-1.5 hover:bg-black/5" href={`/${tenant}/admin/settings`}>
              Settings
            </Link>
          </nav>
        </div>

        {ctx.devMode ? (
          <p className="mt-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dev mode: Supabase auth is not configured — acting as owner.
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Dimensions</h2>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[color:var(--color-muted)]">
                <th className="py-2 pr-4">Dimension</th>
                <th className="py-2 pr-4">Ring</th>
                <th className="py-2 pr-4">Published</th>
                <th className="py-2 pr-4">Latest</th>
                <th className="py-2 pr-4">Data year</th>
                <th className="py-2 pr-4">Discussion</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {dims.map(({ dimension, published, latest }) => {
                const stale = staleBySlug.get(dimension.slug);
                const count = discussed.get(dimension.id) ?? 0;
                return (
                  <tr key={dimension.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">
                      {published?.data.name ?? latest?.data.name ?? dimension.slug}
                    </td>
                    <td className="py-2 pr-4">{dimension.ring}</td>
                    <td className="py-2 pr-4">
                      {published ? (
                        `v${published.versionNum}`
                      ) : (
                        <span className="text-[color:var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {latest ? (
                        <>
                          v{latest.versionNum}
                          <span className="ml-1 text-xs text-[color:var(--color-muted)]">
                            ({latest.origin}
                            {latest.status === 'draft' ? ', draft' : ''})
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {stale?.newestYear ?? '—'}
                      {stale?.stale ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                          stale &gt;{stale.maxAgeYears}y
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">{count > 0 ? `${count} comments` : '—'}</td>
                    <td className="py-2 pr-4">
                      <Link className="underline" href={`/${tenant}/admin/dim/${dimension.id}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {audit.length === 0 ? (
              <li className="text-[color:var(--color-muted)]">No audit entries yet.</li>
            ) : (
              audit.map((entry) => (
                <li key={String(entry.id)} className="flex gap-3">
                  <span className="w-40 shrink-0 text-[color:var(--color-muted)]">
                    {entry.ts.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                  <span>
                    <code>{entry.action}</code> on {entry.entity}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>
    </>
  );
}
