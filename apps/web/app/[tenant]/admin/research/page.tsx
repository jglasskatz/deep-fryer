import type { Metadata } from 'next';
import Link from 'next/link';
import { frameworkDimension } from '@deep-fryer/contract';
import { summarizeRunCosts } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { NewRunForm } from '@/components/admin/NewRunForm';
import { tenantDimensions, tenantRuns } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { billingSummary, keyFundedSessionsNote } from '@/lib/billing';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { runInProgress, runPhase } from '@/lib/run-progress';
import { RunPhaseBadge } from './RunBadges';

export const dynamic = 'force-dynamic';

/** Research runs · Admin · <portrait> (WCAG 2.4.2): the generic site title named none of the staff pages. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Research runs');
}

export default async function ResearchPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'editor');
  const [runs, dims, billing] = await Promise.all([
    tenantRuns(ctx.tenant.id),
    tenantDimensions(ctx.tenant.id),
    billingSummary(ctx.tenant.organizationId),
  ]);
  // The meter is the plan's allowance (plan-funded sessions only); what ran on the organization's own key is named
  // under it, in the same words as on the billing page and the org hub (lib/billing.ts keyFundedSessionsNote).
  const keyNote = keyFundedSessionsNote(billing);
  // A queued run turns into a running one, and a running one settles, without anyone touching this page.
  const anyInProgress = runs.some((run) => runInProgress(runPhase(run)));

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <AutoRefresh everyMs={10_000} active={anyInProgress} />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Research runs</h1>

        <section className="mt-4 rounded border border-black/10 p-3" aria-label="Research allowance">
          {billing.limits && !billing.blockedMessage ? (
            <UsageMeter
              label={`Research sessions this billing period (renews ${billing.subscription!.currentPeriodEnd.toISOString().slice(0, 10)})`}
              used={billing.usage.researchSessions}
              limit={billing.limits.researchSessions}
            />
          ) : (
            <p role="alert" className="text-sm text-red-900">
              {billing.blockedMessage}
            </p>
          )}
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            Planning is free. Sessions count when a run is applied; failed sessions are not
            counted. Shared across every portrait in the organization.
            {billing.apiKey ? ' While the organization’s own API key is on file, runs use that key.' : ''}
            {keyNote ? ` ${keyNote}` : ''}
          </p>
        </section>

        <div className="mt-6">
          <NewRunForm
            tenantSlug={tenant}
            dimensions={dims.map(({ dimension, published, latest }) => ({
              id: dimension.id,
              name: published?.data.name ?? latest?.data.name ?? dimension.slug,
              ring: dimension.ring,
              indicatorCount: frameworkDimension(dimension.slug, dimension.canonicalSlug)?.indicators.length ?? latest?.data.indicators.length ?? 0,
            }))}
          />
        </div>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">History</h2>
          <div className="mt-3 overflow-x-auto">
<table className="w-full min-w-[560px] border-collapse text-sm">
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
                  const cost = summarizeRunCosts(run.tokenUsage);
                  const tokens = cost.sessions.length ? cost.sessions.reduce((total, session) => total + session.input_tokens + session.output_tokens + session.cache_read_tokens + session.cache_write_tokens, 0) : null;
                  return (
                    <tr key={run.id} className="border-b">
                      <td className="py-2 pr-4">
                        <Link className="underline" href={`/${tenant}/admin/research/${run.id}`}>
                          {run.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <RunPhaseBadge phase={runPhase(run)} />
                      </td>
                      <td className="py-2 pr-4">{run.plan.sessions.length}</td>
                      <td className="py-2 pr-4">
                        {run.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-4">{tokens === null ? '—' : tokens.toLocaleString('en-US')}{cost.coverage === 'partial' ? ' (partial)' : ''}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
</div>
        </section>
      </main>
    </>
  );
}
