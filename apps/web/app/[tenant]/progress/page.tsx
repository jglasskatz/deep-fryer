import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PROGRESS_STATUS_LABEL, summarizeProgress, type ProgressStatus } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ProgressTable } from '@/components/progress/ProgressTable';
import { STATUS_EXPLAINER, StatusChip } from '@/components/progress/StatusChip';
import { tenantProgress } from '@/lib/progress';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const p = await tenantProgress((await params).tenant);
  return {
    title: p ? `Progress · ${p.tenant.name}` : 'Progress',
    description: p ? `How ${p.tenant.name} is moving against its adopted goals. Baseline: ${p.config.baseline_label}.` : undefined,
  };
}

const HEADLINE_ORDER: ProgressStatus[] = ['met', 'on_track', 'improving', 'off_track', 'worsening', 'baseline_only'];

/**
 * Public progress (SPEC-v4 §4): every published indicator from its baseline
 * to the latest measurement, against the adopted target and its due date.
 * The data-gap list is part of the deliverable, not a footnote — it is what
 * a portrait asks the city to start measuring.
 */
export default async function ProgressPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const p = await tenantProgress(tenant);
  if (!p) notFound();

  const tracked = p.rows.filter((r) => r.status !== 'no_data' && r.status !== 'no_target');
  const counts = summarizeProgress(p.rows);
  const withDeadline = p.rows.filter((r) => r.targetYear !== null);

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: p.tenant.slug, name: p.tenant.name }} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 print:max-w-none print:px-0">
        <p className="text-sm print:hidden">
          <Link className="underline" href={`/${tenant}`}>
            ← {p.tenant.name}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">Progress: {p.tenant.name}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          <strong className="font-medium text-[color:var(--color-fg)]">Baseline:</strong>{' '}
          {p.config.baseline_label}. Targets are the portrait&apos;s published thresholds — adopted local goals where they exist —
          and where a goal has a due date, progress is judged against a straight path from the
          baseline to that date.
        </p>

        {p.rows.length === 0 ? (
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">Nothing has been published for this portrait yet.</p>
        ) : (
          <>
            <section aria-label="Summary" className="mt-6 flex flex-wrap gap-3">
              {HEADLINE_ORDER.filter((s) => counts[s] > 0).map((s) => (
                <div key={s} className="rounded-lg border border-black/10 px-4 py-3">
                  <div className="text-2xl font-bold tabular-nums">{counts[s]}</div>
                  <div className="mt-1">
                    <StatusChip status={s} />
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-black/10 px-4 py-3 text-sm text-[color:var(--color-muted)]">
                <div className="text-2xl font-bold tabular-nums text-[color:var(--color-fg)]">
                  {tracked.length}/{p.rows.length}
                </div>
                indicators tracked · {withDeadline.length} with a due date
              </div>
            </section>

            <details className="mt-4 text-sm print:hidden">
              <summary className="cursor-pointer text-[color:var(--color-muted)]">What the statuses mean</summary>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {Object.entries(STATUS_EXPLAINER).map(([s, text]) => (
                  <div key={s}>
                    <dt className="inline font-medium">{PROGRESS_STATUS_LABEL[s as ProgressStatus]}: </dt>
                    <dd className="inline">{text}</dd>
                  </div>
                ))}
              </dl>
            </details>

            <div className="mt-8">
              <ProgressTable tenantSlug={p.tenant.slug} rows={p.rows} />
            </div>
          </>
        )}

        {p.gaps.length > 0 ? (
          <section className="mt-12" aria-labelledby="gaps">
            <h2 id="gaps" className="text-xl font-semibold">
              What we can&apos;t measure yet
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">
              Honest gaps: data no agency publishes at this geography. Each is a request — publishing
              it would let this portrait track it.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {p.gaps.map((g) => (
                <li key={`${g.dimensionSlug}-${g.indicator}`} className="rounded border border-dashed border-black/20 p-3">
                  <span className="font-medium">{g.dimensionName}</span> — {g.indicator}
                  <span className="mt-1 block text-[color:var(--color-muted)]">
                    {g.reason.length > 280 ? `${g.reason.slice(0, 277)}…` : g.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12 border-t border-black/10 pt-6 text-sm print:hidden" aria-label="Open data">
          <h2 className="font-semibold">Open data</h2>
          <p className="mt-1 text-[color:var(--color-muted)]">
            The same numbers, machine-readable, for open-data portals and council packets:{' '}
            <a className="underline" href={`/api/v1/portraits/${p.tenant.slug}/progress.csv`}>
              progress.csv
            </a>
            {' · '}
            <a className="underline" href={`/api/v1/portraits/${p.tenant.slug}/progress.json`}>
              progress.json
            </a>
            {' · '}
            <a className="underline" href={`/api/v1/portraits/${p.tenant.slug}`}>
              portrait.json
            </a>
            . Methodology:{' '}
            <Link className="underline" href={`/${p.tenant.slug}/methodology`}>
              thresholds and rationales
            </Link>
            .
          </p>
        </section>
      </main>
    </>
  );
}
