import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PolicyImpactGraph } from '@/components/policy/PolicyImpactGraph';
import { AnalysisStatus } from '@/components/policy/AnalysisStatus';
import { CancelAnalysisButton } from '@/components/policy/CancelAnalysisButton';
import { PolicyDoughnut } from '@/components/policy/PolicyDoughnut';
import { PolicyImpactCards } from '@/components/policy/PolicyImpactCards';
import { adminTenant } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import {
  getPolicyAnalysis,
  impactGroups,
  impactsChartLabel,
  impactsSummary,
  policyDoughnut,
} from '@/lib/policy';
import { requireFeature } from '@/lib/features';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

/**
 * The analysis title is the page title, so each analysis is told apart in
 * tabs and history, and — because Next's route announcer speaks a changed
 * document title — a screen reader hears the analysis open after "Analyze"
 * navigates here. The read runs under row-level security (editors only), so
 * someone who may not see the analysis gets the generic title, and the page
 * itself then turns them away.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}): Promise<Metadata> {
  const { tenant, id } = await params;
  const t = await adminTenant(tenant);
  const analysis = t ? await getPolicyAnalysis(t.id, id) : null;
  return {
    title: analysis ? `${analysis.title} · Policy analysis` : 'Policy analysis',
    robots: { index: false },
  };
}

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * One policy analysis (SPEC-v5 §2). While it waits or runs, a live status
 * line polls for the status and re-renders the page when it changes (a
 * queued analysis can be cancelled to release its session); once complete
 * it shows the summary, the flashing doughnut (today ↔ with this policy)
 * with its caption in words, and the impacts table — the chart's accessible
 * equivalent, one row group per dimension with the anchor the doughnut's
 * wedges link to. Everything here is labeled as a projection. A failed
 * analysis links to the form prefilled with the same brief.
 */
export default async function PolicyAnalysisPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  await requireFeature(tenant, 'policy_analysis');
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/policy/${id}`);
  const analysis = await getPolicyAnalysis(ctx.tenant.id, id);
  if (!analysis) notFound();

  const result = analysis.status === 'complete' ? analysis.result : null;
  const projections = analysis.projections ?? [];
  const doughnut = result ? await policyDoughnut(ctx.tenant.slug, projections, result.portrait_baseline) : null;
  const groups = result ? impactGroups(result, projections) : [];
  const onDoughnut = new Set(doughnut?.dimensions.map((d) => d.slug) ?? []);
  const source = safeHref(analysis.sourceUrl);
  const tokens = analysis.tokenUsage
    ? analysis.tokenUsage.input_tokens + analysis.tokenUsage.output_tokens
    : null;
  const adjustments = analysis.adjustments ?? [];
  // Every failure tells staff to try again; this carries the brief over so
  // they never have to copy up to 60,000 characters out of a scroll box.
  const runAgain = `/${tenant}/admin/policy?from=${analysis.id}#new-analysis`;

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin/policy`}>
            ← Policy analyses
          </Link>
        </p>
        {/* Staff-entered: may be a pasted link (no spaces to wrap at) or right-to-left text. */}
        <h1 dir="auto" className="mt-2 text-2xl font-bold wrap-anywhere">
          {analysis.title}
        </h1>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[color:var(--color-muted)]">
          <div className="flex gap-1">
            <dt>Source:</dt>
            <dd>
              {source ? (
                <a className="break-all underline" href={source} target="_blank" rel="noreferrer">
                  {source}
                </a>
              ) : (
                (analysis.sourceUrl ?? 'none given')
              )}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Requested:</dt>
            <dd>{when(analysis.createdAt)}</dd>
          </div>
          {analysis.completedAt ? (
            <div className="flex gap-1">
              <dt>Finished:</dt>
              <dd>{when(analysis.completedAt)}</dd>
            </div>
          ) : null}
          {tokens ? (
            <div className="flex gap-1">
              <dt>Tokens:</dt>
              <dd>{tokens.toLocaleString('en-US')}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3">
          <AnalysisStatus
            status={analysis.status}
            statusUrl={`/${tenant}/admin/policy/${analysis.id}/status`}
            createdAt={analysis.createdAt.toISOString()}
            startedAt={analysis.startedAt?.toISOString() ?? null}
            renderedAt={new Date().toISOString()}
          />
          {analysis.status === 'queued' ? <CancelAnalysisButton tenantSlug={tenant} id={analysis.id} /> : null}
        </div>

        {analysis.status === 'failed' ? (
          <section className="mt-4 rounded border border-black/15 p-4" aria-label="Why it failed">
            <p className="text-sm">{analysis.error ?? 'The analysis did not finish.'}</p>
            <p className="mt-2 text-sm text-[color:var(--color-muted)]">
              Failed analyses are not counted against your plan.
            </p>
            <p className="mt-3">
              <Link
                className="inline-block rounded bg-black px-3 py-1.5 text-sm font-medium text-white"
                href={runAgain}
              >
                Run again with this brief
              </Link>
            </p>
          </section>
        ) : null}

        {result && (result.impact_graph || doughnut) ? (
          <>
            <aside
              className="mt-6 rounded border-2 border-amber-500 p-4 text-sm"
              aria-label="About this analysis"
            >
              <p className="font-semibold">
                {result.impact_graph ? 'Evidence graph — AI-classified claims, not independently verified policy effects.' : 'Modeled scenario — not a measured policy effect.'}
              </p>
              <p className="mt-1">
                {result.impact_graph ? 'Review each claim, source excerpt, study design and scope. Source text matching is not independent validation; graph categories do not represent custom portrait scores. Nothing here is published.' : 'Check each rationale, time horizon and source before relying on an estimate. Qualified projections use the analysis baseline’s fixed thresholds. Missing units, dates or evidence remain direction-only. This comparison does not establish causation; nothing here is published.'}
              </p>
              {adjustments.length ? (
                <>
                  <p className="mt-3 font-semibold">Adjusted to fit the analysis format</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 wrap-anywhere">
                    {adjustments.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </aside>

            <section className="mt-6" aria-labelledby="summary-heading">
              <h2 id="summary-heading" className="text-lg font-semibold">
                Summary
              </h2>
              <p dir="auto" className="mt-2 max-w-3xl whitespace-pre-line text-sm wrap-anywhere">
                {result.summary}
              </p>
            </section>

            {result.impact_graph ? <PolicyImpactGraph value={result.impact_graph} /> : doughnut ? <section className="mt-8" aria-labelledby="doughnut-heading">
              <h2 id="doughnut-heading" className="text-lg font-semibold">
                {doughnut.baselineComplete ? 'Compare the analysis baseline and modeled scenario' : 'Legacy comparison — incomplete baseline'}
              </h2>
              {!doughnut.baselineComplete ? <p className="mt-2 text-sm">The complete original portrait was not saved with this analysis. Current portrait geometry is shown for context; legacy quantified estimates are not verified.</p> : null}
              {doughnut.baselineComplete && doughnut.republished.length ? (
                <p className="mt-2 text-sm">
                  {listNames(doughnut.republished)}{' '}
                  {doughnut.republished.length === 1 ? 'has' : 'have'} been republished since this
                  analysis ran. This comparison keeps the original analysis baseline, so newer measurements are not mixed with earlier estimates.
                </p>
              ) : null}
              <div className="mt-4">
                {doughnut.dimensions.length ? (
                  <PolicyDoughnut
                    dimensions={doughnut.dimensions}
                    baselineComplete={doughnut.baselineComplete}
                    ariaLabel={impactsChartLabel(ctx.tenant.name)}
                    summary={impactsSummary(doughnut.dimensions, projections, doughnut.republished).replace('impacts table', 'impact cards')}
                  />
                ) : (
                  <p className="text-sm text-[color:var(--color-muted)]">
                    This portrait has no published dimensions yet, so there is no doughnut to draw.
                    The impacts are listed below.
                  </p>
                )}
              </div>
            </section> : null}

            <section className="mt-8" aria-labelledby="impacts-heading">
              <h2 id="impacts-heading" className="text-lg font-semibold">
                Impacts
              </h2>
              {groups.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {result.impact_graph ? 'Cross-slice evidence is listed above; no additional legacy projections were supplied.' : 'No impacts were supplied. This does not establish that the policy has no effect.'}
                </p>
              ) : (
                <PolicyImpactCards groups={groups} onDoughnut={[...onDoughnut]} />
              )}
            </section>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <TextList heading="Assumptions" items={result.assumptions} />
              <TextList heading="Risks" items={result.risks} />
            </div>
          </>
        ) : null}

        <details className="mt-8 rounded border border-black/15 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            The brief ({analysis.brief.length.toLocaleString('en-US')} characters)
          </summary>
          {/* Focusable so the keyboard can scroll it in every browser (Safari
              does not make scroll containers focusable on its own); dir=auto
              lays out a pasted Arabic or Urdu policy right to left. */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Brief text"
            dir="auto"
            className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-3 text-sm wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          >
            {analysis.brief}
          </div>
          <p className="mt-2 text-sm">
            <Link className="underline" href={runAgain}>
              Start a new analysis from this brief
            </Link>
          </p>
        </details>
      </main>
    </>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function TextList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <section aria-label={heading}>
      <h2 className="text-lg font-semibold">{heading}</h2>
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm wrap-anywhere">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">None listed.</p>
      )}
    </section>
  );
}

