import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { AnalysisStatus } from '@/components/policy/AnalysisStatus';
import { CancelAnalysisButton } from '@/components/policy/CancelAnalysisButton';
import { DirectionLabel, PolicyDoughnut } from '@/components/policy/PolicyDoughnut';
import { adminTenant } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import {
  getPolicyAnalysis,
  impactGroups,
  impactsChartLabel,
  impactsSummary,
  policyDoughnut,
  type ImpactGroup,
  type ImpactRow,
  type WedgeOutcome,
} from '@/lib/policy';
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
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/policy/${id}`);
  const analysis = await getPolicyAnalysis(ctx.tenant.id, id);
  if (!analysis) notFound();

  const result = analysis.status === 'complete' ? analysis.result : null;
  const projections = analysis.projections ?? [];
  const doughnut = result ? await policyDoughnut(ctx.tenant.slug, projections) : null;
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

        {result && doughnut ? (
          <>
            <aside
              className="mt-6 rounded border-2 border-amber-500 p-4 text-sm"
              aria-label="About this analysis"
            >
              <p className="font-semibold">
                Projection, not measurement — drafted with AI assistance for staff review.
              </p>
              <p className="mt-1">
                Check each rationale and its sources before relying on it. Quantified projections
                are re-scored with the same thresholds as the published portrait, so the two are
                comparable; nothing here is published.
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

            <section className="mt-8" aria-labelledby="doughnut-heading">
              <h2 id="doughnut-heading" className="text-lg font-semibold">
                The doughnut, today and with this policy
              </h2>
              {doughnut.republished.length ? (
                <p className="mt-2 text-sm">
                  {listNames(doughnut.republished)}{' '}
                  {doughnut.republished.length === 1 ? 'has' : 'have'} been republished since this
                  analysis ran. “Today” shows the portrait as published now; projected sizes were
                  computed against the data published then.
                </p>
              ) : null}
              <div className="mt-4">
                {doughnut.dimensions.length ? (
                  <PolicyDoughnut
                    dimensions={doughnut.dimensions}
                    ariaLabel={impactsChartLabel(ctx.tenant.name)}
                    summary={impactsSummary(doughnut.dimensions, projections, doughnut.republished)}
                  />
                ) : (
                  <p className="text-sm text-[color:var(--color-muted)]">
                    This portrait has no published dimensions yet, so there is no doughnut to draw.
                    The impacts are listed below.
                  </p>
                )}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="impacts-heading">
              <h2 id="impacts-heading" className="text-lg font-semibold">
                Impacts
              </h2>
              {groups.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  The analysis found no impact on any of the doughnut&apos;s dimensions.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[960px] border-collapse text-sm">
                    <caption className="sr-only">
                      Every projected impact, grouped by dimension, with direction, magnitude,
                      confidence, the indicator change where quantified, rationale, and sources.
                    </caption>
                    <thead>
                      <tr className="border-b text-left align-bottom text-[color:var(--color-muted)]">
                        <th scope="col" className="py-2 pr-4">Dimension</th>
                        <th scope="col" className="py-2 pr-4">Direction</th>
                        <th scope="col" className="py-2 pr-4">Magnitude</th>
                        <th scope="col" className="py-2 pr-4">Confidence</th>
                        <th scope="col" className="py-2 pr-4">Indicator change</th>
                        <th scope="col" className="py-2 pr-4">Rationale</th>
                        <th scope="col" className="py-2 pr-4">Sources</th>
                      </tr>
                    </thead>
                    {groups.map((g) => (
                      <ImpactRowGroup key={g.slug} group={g} onDoughnut={onDoughnut.has(g.slug)} />
                    ))}
                  </table>
                </div>
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

/** Why a quantified wedge keeps its size, in the table (lib/policy.ts wedgeOutcome). */
const UNMOVED_NOTE: Record<Exclude<WedgeOutcome, 'resized'>, string> = {
  worse_indicator: 'Wedge unchanged: a dimension is drawn at its worst indicator, and another indicator stays further out.',
  display_range: 'Wedge unchanged: the dimension is beyond the chart’s range now and with this policy, so it stays at the edge.',
  too_small: 'Wedge unchanged: the change is smaller than one step on the chart.',
  unmoved: 'Wedge unchanged by the projected change.',
};

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * One dimension's impacts. The first row carries `impact-{slug}`, the anchor
 * a doughnut wedge jumps to; the dimension cell heads the whole group.
 */
function ImpactRowGroup({ group, onDoughnut }: { group: ImpactGroup; onDoughnut: boolean }) {
  return (
    <tbody className="border-b">
      {group.rows.map((row, i) => (
        <tr
          key={i}
          id={i === 0 ? `impact-${group.slug}` : undefined}
          className="scroll-mt-24 align-top target:bg-black/5"
        >
          {i === 0 ? (
            <th scope="rowgroup" rowSpan={group.rows.length} className="py-2 pr-4 text-left font-semibold">
              {group.name}
              {group.rows.length > 1 && group.direction !== 'none' ? (
                <span className="mt-1 block text-xs font-normal text-[color:var(--color-muted)]">
                  Overall: <DirectionLabel direction={group.direction} />
                </span>
              ) : null}
              {!onDoughnut ? (
                <span className="mt-1 block text-xs font-normal text-[color:var(--color-muted)]">
                  Not published on this portrait
                </span>
              ) : null}
              {onDoughnut && group.wedge && group.wedge !== 'resized' ? (
                <span className="mt-1 block text-xs font-normal text-[color:var(--color-muted)]">
                  {UNMOVED_NOTE[group.wedge]}
                </span>
              ) : null}
            </th>
          ) : null}
          <td className="py-2 pr-4 whitespace-nowrap">
            <DirectionLabel direction={row.impact.direction} />
          </td>
          <td className="py-2 pr-4">{capitalize(row.impact.magnitude)}</td>
          <td className="py-2 pr-4">{capitalize(row.impact.confidence)}</td>
          <td className="py-2 pr-4">
            <IndicatorChangeCell row={row} />
          </td>
          <td className="min-w-[14rem] py-2 pr-4">{row.impact.rationale}</td>
          <td className="py-2 pr-4">
            <SourceList sources={row.impact.sources} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function IndicatorChangeCell({ row }: { row: ImpactRow }) {
  const { change } = row;
  if (change) {
    return (
      <>
        <span className="block">{change.indicator}</span>
        {/* Each value stays on one line; the pair may wrap at the arrow so long units leave room for the rationale. */}
        <span className="block font-medium tabular-nums">
          <span className="whitespace-nowrap">{formatIndicatorValue(change.current_value, change.unit)}</span> →{' '}
          <span className="whitespace-nowrap">{formatIndicatorValue(change.projected_value, change.unit)}</span>
        </span>
        {/* The values above carry the unit; the projection's year completes the claim. */}
        <span className="block text-xs text-[color:var(--color-muted)]">
          {change.projected_year ? `Projected for ${change.projected_year}` : 'Projected; year not given'}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="block">Direction only</span>
      {row.unquantified.length ? (
        <span className="block text-xs text-[color:var(--color-muted)]">
          Not quantified: {row.unquantified.join('; ')}.
        </span>
      ) : null}
    </>
  );
}

function SourceList({ sources }: { sources: ImpactRow['impact']['sources'] }) {
  if (sources.length === 0) return <span className="text-[color:var(--color-muted)]">—</span>;
  return (
    <ul className="space-y-1">
      {sources.map((s, i) => {
        const href = safeHref(s.url);
        return (
          <li key={i}>
            {href ? (
              <a className="underline" href={href} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </li>
        );
      })}
    </ul>
  );
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
