import type { Metadata } from 'next';
import Link from 'next/link';
import { formatIndicatorValue } from '@deep-fryer/core';
import type { Finding } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ApproveUnflagged, type SpotCheckItem } from '@/components/admin/ApproveUnflagged';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { requireAdminPage } from '@/lib/admin-guard';
import {
  draftHref,
  draftNote,
  draftPortrait,
  OPEN_REASON_TEXT,
  runSettled,
  type DraftDimension,
} from '@/lib/draft-portrait';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { fmt } from '@/lib/i18n/format';
import { en } from '@/lib/i18n/messages/en';
import { adminPageMetadata } from '@/lib/page-meta';
import { safeHref } from '@/lib/safe-url';
import { RUN_PHASE_LABEL, runInProgress, runPhase } from '@/lib/run-progress';
import { RunPhaseBadge } from '../research/RunBadges';
import { DraftDoughnut, type DraftWedge } from './DraftDoughnut';

export const dynamic = 'force-dynamic';

/**
 * While the run is queued or running the page re-renders itself this often
 * (components/admin/AutoRefresh.tsx), as the run page does: each finished
 * session's dimension fills in on the next refresh.
 */
const REFRESH_MS = 5_000;

/** How many runs the picker offers; the research page lists them all. */
const RUNS_LISTED = 8;

/** Draft doughnut · Admin · <portrait>: never indexed (adminPageMetadata), like every staff page. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Draft doughnut');
}

const shortDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One finding of the spot-check sample as the confirmation lists it: what it
 * says, its source (linked only when the address is a safe http(s) link, as
 * on the review card) and its review card. The sample holds only approvable
 * findings, which are indicators.
 */
function spotCheckItem(tenant: string, runId: string, f: Finding, nameById: Map<string, string>): SpotCheckItem {
  const p = f.payload;
  const dimension = nameById.get(f.dimensionId) ?? f.indicatorSlug;
  const reviewHref = `/${tenant}/admin/review?run=${runId}#review-${f.dimensionId}`;
  if (p.kind !== 'indicator') {
    return { id: f.id, label: `${dimension} — ${f.indicatorSlug}`, value: '', source: '', sourceHref: null, reviewHref };
  }
  return {
    id: f.id,
    label: `${dimension} — ${p.name}`,
    value: `${formatIndicatorValue(p.value, p.unit)} (${p.year})`,
    source: p.source,
    sourceHref: safeHref(p.source_url) ?? null,
    reviewHref,
  };
}

/**
 * The private draft doughnut (staff, editor and up): the portrait as the
 * latest research would make it once approved and published — every
 * dimension the run produced, its status worked out by the same engine
 * approving uses (lib/draft-portrait.ts), and the published version for
 * every dimension it did not. `?run=<id>` builds it from an earlier run.
 *
 * Never public: the admin guard turns away anyone below editor, the service
 * worker never caches /<portrait>/admin pages (public/sw.js NEVER_CACHE), the
 * page is rendered per request and marked noindex. It says "draft" in its
 * heading, in a notice the chart is described by, across the chart, and in
 * the chart's text alternative. While the run is in progress it refreshes
 * itself and fills in as sessions finish. Each wedge and row opens where its
 * data is reviewed. Once the run has settled and every flagged dimension has
 * been dealt with on its card, "Approve all unflagged" approves as drafts
 * every dimension whose findings all passed, after the reviewer checks a
 * random sample of them; until then the section lists what is still open.
 */
export default async function DraftDoughnutPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { run: runParam } = await searchParams;
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/draft`);

  const draft = await draftPortrait(ctx.tenant.id, typeof runParam === 'string' ? runParam : undefined);
  const { run, phase, bulk } = draft;
  const settled = run ? runSettled(run) : false;
  const labels = doughnutLabels(en);

  const wedge = (d: DraftDimension): DraftWedge => {
    const first = d.data?.indicators[0];
    return {
      ring: d.ring,
      slug: d.slug,
      name: d.name,
      viz_level: d.vizLevel,
      indicator: first?.name,
      value:
        first?.value === null || first?.value === undefined
          ? undefined
          : formatIndicatorValue(first.value, first.unit),
      year: first?.year ?? undefined,
      source: first?.source || undefined,
      href: draftHref(tenant, d, run ? { id: run.id, settled } : null),
      note: draftNote(d, settled),
    };
  };
  const all = draft.dimensions;
  const social = all.filter((d) => d.ring === 'social').map(wedge);
  const ecological = all.filter((d) => d.ring === 'ecological').map(wedge);

  const outside = all.filter((d) => d.vizLevel !== null && d.vizLevel > 0).length;
  const gaps = all.filter((d) => d.vizLevel === null).length;
  const summary = `Draft, not published. ${fmt(gaps ? labels.summaryWithGaps : labels.summary, {
    name: ctx.tenant.name,
    outside,
    total: all.length,
    gaps,
  })}`;

  const fromRun = all.filter((d) => d.source === 'research' || d.source === 'approved').length;
  const approved = all.filter((d) => d.source === 'approved').length;
  const inSoFar = all.filter((d) => d.findings > 0).length;
  const stillResearching = all.filter((d) => d.pending).length;
  const nameById = new Map(all.map((d) => [d.dimensionId, d.name]));

  const runs = draft.runs.slice(0, RUNS_LISTED);
  if (run && !runs.some((r) => r.id === run.id)) runs.push(run);

  const statusLine = !run
    ? null
    : phase === 'queued'
      ? `Run ${run.id.slice(0, 8)} is queued. The draft fills in as its sessions finish; this page updates by itself.`
      : phase === 'running'
        ? `Run ${run.id.slice(0, 8)} is running: ${inSoFar} dimension${inSoFar === 1 ? '' : 's'} in so far, ${stillResearching} still being researched. This page updates by itself.`
        : `Run ${run.id.slice(0, 8)} ${phase === 'failed' ? 'stopped with failures' : 'finished'}: ${fromRun} of ${all.length} dimensions shown from its research${approved ? ` (${approved} approved as drafts)` : ''}, the rest as published.`;

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <AutoRefresh everyMs={REFRESH_MS} active={phase !== null && runInProgress(phase)} />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <p className="mt-4 inline-block rounded bg-red-800 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-white">
          Draft · staff only
        </p>
        <h1 className="mt-2 text-2xl font-bold">Draft doughnut</h1>
        <p
          id="draft-about"
          className="mt-3 max-w-3xl rounded border-s-4 border-red-800 bg-red-50 p-3 text-sm text-red-950"
        >
          This is a draft, for staff only — it is not public and nothing on it is published. It shows {ctx.tenant.name}{' '}
          as the latest research would make it: each dimension this run produced, with its status worked out
          exactly as approving and publishing it would, and every other dimension as it is published now.
          Nothing reaches the public portrait until a reviewer approves and publishes it.
        </p>

        {!run ? (
          <p className="mt-6 text-sm">
            No research has run on this portrait yet, so there is no draft.{' '}
            <Link className="underline" href={`/${tenant}/admin/research`}>
              Plan a research run
            </Link>
            .
          </p>
        ) : (
          <>
            {runs.length > 1 ? (
              <nav aria-label="Build the draft from another run" className="mt-6 flex flex-wrap gap-2 text-xs">
                {runs.map((r) => {
                  const current = r.id === run.id;
                  return (
                    <Link
                      key={r.id}
                      href={`/${tenant}/admin/draft?run=${r.id}`}
                      aria-current={current ? 'page' : undefined}
                      className={`rounded border px-2 py-1 ${current ? 'bg-black text-white' : 'hover:bg-black/5'}`}
                    >
                      {shortDate(r.createdAt)} · {r.id.slice(0, 8)} · {RUN_PHASE_LABEL[runPhase(r)]}
                    </Link>
                  );
                })}
              </nav>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
              {phase ? <RunPhaseBadge phase={phase} /> : null}
              {/* One live region for every state, so the draft filling in is announced as the page refreshes. */}
              <p role="status" className="text-sm font-medium">
                {statusLine}
              </p>
            </div>
            <p className="mt-1 text-sm">
              <Link className="underline" href={`/${tenant}/admin/research/${run.id}`}>
                Run page
              </Link>
              {settled ? (
                <>
                  {' · '}
                  <Link className="underline" href={`/${tenant}/admin/review?run=${run.id}`}>
                    Review queue for this run
                  </Link>
                </>
              ) : null}
            </p>

            <div className="mt-8">
              <DraftDoughnut
                social={social}
                ecological={ecological}
                labels={labels}
                summary={summary}
                describedBy="draft-about"
              />
            </div>

            {bulk ? (
              <section aria-labelledby="bulk-heading" className="mt-10 rounded border border-black/15 p-4">
                <h2 id="bulk-heading" className="text-lg font-semibold">
                  Approve all unflagged
                </h2>
                <p className="mt-1 max-w-3xl text-sm">
                  Approves as drafts every dimension of this run whose findings all passed — each a sourced
                  indicator the verifier checked with nothing flagged, from a session that completed — just as
                  &ldquo;Approve as draft&rdquo; does on its card, after you check a random few of them against
                  their sources. Nothing is published. Every flagged finding is reviewed on its own card first:
                  while any is still open, nothing is approved in bulk.
                </p>
                {bulk.open.length > 0 ? (
                  <div className="mt-3 text-sm">
                    <p className="font-medium">
                      {bulk.open.length === 1
                        ? '1 dimension still has flagged findings to review one by one:'
                        : `${bulk.open.length} dimensions still have flagged findings to review one by one:`}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {bulk.open.map(({ dimension, reason }) => (
                        <li key={dimension.id}>
                          <Link
                            className="underline"
                            href={`/${tenant}/admin/review?run=${run.id}#review-${dimension.id}`}
                          >
                            {nameById.get(dimension.id) ?? dimension.slug}
                          </Link>
                          : {OPEN_REASON_TEXT[reason]}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[color:var(--color-muted)]">
                      Approve, edit, flag as a data gap, or re-research each one
                      {bulk.findingCount > 0
                        ? `; then the ${bulk.findingCount === 1 ? 'finding' : `${bulk.findingCount} findings`} that passed can be approved here together`
                        : ''}
                      .
                    </p>
                  </div>
                ) : (
                  // The outcome of an approval (the component's live region) comes first, then
                  // what is left — so "Approved 5 findings" is not read after "nothing is left".
                  <>
                    <ApproveUnflagged
                      tenantSlug={tenant}
                      runId={run.id}
                      findings={bulk.findingCount}
                      dimensions={bulk.eligible.length}
                      sample={bulk.sample.map((f) => spotCheckItem(tenant, run.id, f, nameById))}
                    />
                    {bulk.findingCount === 0 ? (
                      <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                        Nothing is left to approve this way: every dimension this run researched has been approved,
                        reviewed by hand, or planned for research again.
                      </p>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
