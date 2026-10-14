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
import { billingSummary, WARNING_COPY } from '@/lib/billing';
import { tenantMembersList } from '@/lib/member-data';
import { organizationMembersList } from '@/lib/member-data';

export const dynamic = 'force-dynamic';

export default async function TenantAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { tenant } = await params;
  const { welcome } = await searchParams;
  const ctx = await requireAdminPage(tenant, 'viewer');

  const [dims, config, runs, audit, discussed, billing, members, orgMembers] = await Promise.all([
    tenantDimensions(ctx.tenant.id),
    tenantConfigMap(ctx.tenant.id),
    tenantRuns(ctx.tenant.id),
    recentAudit(ctx.tenant.id, 10),
    commentCounts(ctx.tenant.id),
    billingSummary(ctx.tenant.organizationId),
    tenantMembersList(ctx.tenant.id),
    organizationMembersList(ctx.tenant.organizationId),
  ]);

  // Getting-started checklist (SPEC-v4 §2): derived from real state, so it
  // disappears on its own once the portrait is live.
  const checklist = [
    {
      done: Boolean(config.region?.definition && config.region.context_notes),
      label: 'Describe the boundary and local data portals',
      href: `/${tenant}/admin/settings`,
    },
    {
      done: members.length + orgMembers.length > 1,
      label: 'Invite your team',
      href: `/${tenant}/admin/members`,
    },
    {
      done: runs.some((r) => r.appliedAt !== null),
      label: 'Run the first research pass',
      href: `/${tenant}/admin/research`,
    },
    {
      done: dims.some((d) => d.published !== null),
      label: 'Review findings and publish',
      href: `/${tenant}/admin/review`,
    },
    {
      done: (ctx.tenant.embedOrigins ?? []).length > 0,
      label: 'Embed the doughnut on your website',
      href: `/${tenant}/admin/settings#embedding`,
    },
  ];
  const showChecklist = welcome === '1' || checklist.some((c) => !c.done);
  const staleness = stalenessOverview(dims, config.recency);
  const staleBySlug = new Map(staleness.map((s) => [s.slug, s]));
  const activeRuns = runs.filter((r) => r.status === 'planned' || r.status === 'running');

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Admin</h1>
          <nav aria-label="Admin sections" className="flex flex-wrap gap-2 text-sm">
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

        {billing.blockedMessage ? (
          <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {billing.blockedMessage}
          </p>
        ) : billing.standing.warning ? (
          <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {WARNING_COPY[billing.standing.warning]}
          </p>
        ) : null}

        {showChecklist ? (
          <section className="mt-6 rounded-lg border border-black/10 bg-white/60 p-4" aria-labelledby="getting-started">
            <h2 id="getting-started" className="text-base font-semibold">
              {welcome === '1' ? `Welcome — ${ctx.tenant.name} is ready.` : 'Getting started'}
            </h2>
            <ol className="mt-2 space-y-1 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <span aria-hidden className={c.done ? 'text-green-700' : 'text-[color:var(--color-muted)]'}>
                    {c.done ? '✓' : '○'}
                  </span>
                  <a href={c.href} className={c.done ? 'text-[color:var(--color-muted)] line-through' : 'underline'}>
                    {c.label}
                  </a>
                  <span className="sr-only">{c.done ? '(done)' : '(to do)'}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {ctx.devMode ? (
          <p className="mt-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dev mode: AUTH_SECRET is not set — every request acts as owner. Never deploy this way (production refuses to start).
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Dimensions</h2>
          <div className="mt-3 overflow-x-auto">
<table className="w-full min-w-[720px] border-collapse text-sm">
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
                    <td className="py-2 pr-4">{count > 0 ? `${count} comment${count === 1 ? '' : 's'}` : '—'}</td>
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
</div>
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
