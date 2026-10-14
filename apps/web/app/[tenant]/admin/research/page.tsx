import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { NewRunForm } from '@/components/admin/NewRunForm';
import { tenantDimensions, tenantRuns } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

export default async function ResearchPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'editor');
  const [runs, dims] = await Promise.all([
    tenantRuns(ctx.tenant.id),
    tenantDimensions(ctx.tenant.id),
  ]);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Research runs</h1>

        <div className="mt-6">
          <NewRunForm
            tenantSlug={tenant}
            dimensions={dims.map(({ dimension, published, latest }) => ({
              id: dimension.id,
              name: published?.data.name ?? latest?.data.name ?? dimension.slug,
              ring: dimension.ring,
            }))}
          />
        </div>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">History</h2>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[color:var(--color-muted)]">
                <th className="py-2 pr-4">Run</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Sessions</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-[color:var(--color-muted)]">
                    No runs yet. Plan one above — planning is free.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const tokens = run.tokenUsage
                    ? Object.values(run.tokenUsage).reduce(
                        (a, u) => a + u.input_tokens + u.output_tokens,
                        0,
                      )
                    : null;
                  return (
                    <tr key={run.id} className="border-b">
                      <td className="py-2 pr-4">
                        <Link className="underline" href={`/${tenant}/admin/research/${run.id}`}>
                          {run.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-2 pr-4">{run.plan.sessions.length}</td>
                      <td className="py-2 pr-4">
                        {run.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-4">{tokens ? tokens.toLocaleString() : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'complete'
      ? 'bg-green-100 text-green-900'
      : status === 'failed'
        ? 'bg-red-100 text-red-900'
        : status === 'running'
          ? 'bg-blue-100 text-blue-900'
          : 'bg-black/5';
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{status}</span>;
}
