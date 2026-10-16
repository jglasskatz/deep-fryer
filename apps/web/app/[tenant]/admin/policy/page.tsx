import type { Metadata } from 'next';
import Link from 'next/link';
import { POLICY_ANALYSIS_SESSIONS } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { NewPolicyForm } from '@/components/policy/NewPolicyForm';
import { PolicyStatusBadge } from '@/components/policy/PolicyStatusBadge';
import { requireAdminPage } from '@/lib/admin-guard';
import { billingSummary, type BillingSummary } from '@/lib/billing';
import { getPolicyAnalysis, listPolicyAnalyses } from '@/lib/policy';
import { requireFeature } from '@/lib/features';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Policy analysis', robots: { index: false } };

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const sessions = `${POLICY_ANALYSIS_SESSIONS} research session${POLICY_ANALYSIS_SESSIONS === 1 ? '' : 's'}`;

/** The link's host for a compact column; the full link when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Why the form cannot start an analysis right now, or null. The server
 * action re-checks under the subscription lock; this only spares staff a
 * round trip when the answer is already known.
 */
function blockedReason(billing: BillingSummary): string | null {
  if (!billing.limits || billing.blockedMessage) {
    return billing.blockedMessage ?? 'Research is not available on this plan.';
  }
  const remaining = billing.limits.researchSessions - billing.usage.researchSessions;
  if (remaining >= POLICY_ANALYSIS_SESSIONS) return null;
  const renews = billing.subscription!.currentPeriodEnd.toISOString().slice(0, 10);
  return `This billing period's research sessions are used up (${billing.usage.researchSessions} of ${billing.limits.researchSessions}). The allowance renews on ${renews}; upgrade the plan under Billing for more.`;
}

/**
 * Policy analysis, staff plane (SPEC-v5 §2): start an analysis and see past
 * ones. `?from={id}` prefills the form with an earlier analysis's title,
 * source, and brief — the "Run again with this brief" link on a failed
 * analysis — so starting over never means copying the brief by hand. The
 * new analysis still goes through the same action and allowance check.
 */
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { tenant } = await params;
  await requireFeature(tenant, 'policy_analysis');
  const { from } = await searchParams;
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/policy`);
  const [analyses, billing, previous] = await Promise.all([
    listPolicyAnalyses(ctx.tenant.id),
    billingSummary(ctx.tenant.organizationId),
    typeof from === 'string' ? getPolicyAnalysis(ctx.tenant.id, from) : null,
  ]);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Policy analysis</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          Paste a policy brief to see how it is projected to move {ctx.tenant.name}&apos;s doughnut:
          which dimensions it would improve or worsen, by how much where the evidence allows, and
          why. Analyses are drafted with AI assistance for staff review — projections, not
          measurements — and are never published.
        </p>

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
            Each analysis uses {sessions} from the same allowance
            as research runs, shared across every portrait in the organization. Failed analyses are
            not counted.
          </p>
        </section>

        <div className="mt-6">
          <NewPolicyForm
            // Remount when the prefill source changes, so the fields take the new values.
            key={previous?.id ?? 'blank'}
            tenantSlug={tenant}
            blockedReason={blockedReason(billing)}
            initial={
              previous
                ? { title: previous.title, sourceUrl: previous.sourceUrl ?? '', brief: previous.brief }
                : undefined
            }
          />
        </div>

        <section className="mt-8" aria-labelledby="analyses-heading">
          <h2 id="analyses-heading" className="text-lg font-semibold">
            Analyses
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-[color:var(--color-muted)]">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {analyses.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-[color:var(--color-muted)]">
                      No analyses yet. Paste a brief above to start one.
                    </td>
                  </tr>
                ) : (
                  analyses.map((a) => {
                    const source = safeHref(a.sourceUrl);
                    return (
                      <tr key={a.id} className="border-b">
                        <td dir="auto" className="py-2 pr-4 wrap-anywhere">
                          <Link className="underline" href={`/${tenant}/admin/policy/${a.id}`}>
                            {a.title}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">
                          <PolicyStatusBadge status={a.status} />
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{when(a.createdAt)}</td>
                        <td className="py-2 pr-4">
                          {source ? (
                            <a className="underline" href={source} target="_blank" rel="noreferrer">
                              {hostOf(source)}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
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
