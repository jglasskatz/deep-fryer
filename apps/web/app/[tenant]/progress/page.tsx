import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { summarizeProgress, type ProgressStatus } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { SampleDataNotice } from '@/components/sample-data/SampleDataNotice';
import { ProgressTable } from '@/components/progress/ProgressTable';
import { StatusChip } from '@/components/progress/StatusChip';
import { dimensionLabel } from '@/lib/i18n/content';
import { fmt, fmtPlural, rich } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import { tenantProgress } from '@/lib/progress';
import { portraitSampleData } from '@/lib/sample-data';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const [p, { m }] = await Promise.all([tenantProgress((await params).tenant), getI18n()]);
  return {
    title: p ? fmt(m.progress.metaTitle, { name: p.tenant.name }) : m.nav.progress,
    description: p ? fmt(m.progress.metaDescription, { name: p.tenant.name }) : undefined,
  };
}

const HEADLINE_ORDER: ProgressStatus[] = ['met', 'on_track', 'improving', 'off_track', 'worsening', 'baseline_only'];

/**
 * Public progress (SPEC-v4 §4): every published indicator from its baseline
 * to the latest measurement, against the adopted target and its due date.
 * The data-gap list is part of the deliverable, not a footnote — it is what
 * a portrait asks the city to start measuring.
 *
 * A portrait seeded with synthetic values (scripts/seed-demo-data.ts, which
 * publishes several years so every status shows) says so under the heading,
 * before any count: "met / worsening" over made-up numbers is exactly the
 * screenshot the notice exists to prevent.
 */
export default async function ProgressPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const [p, { m, locale, href }, sample] = await Promise.all([
    tenantProgress(tenant),
    getI18n(),
    portraitSampleData(tenant),
  ]);
  if (!p) notFound();

  const tracked = p.rows.filter((r) => r.status !== 'no_data' && r.status !== 'no_target');
  const counts = summarizeProgress(p.rows);
  const withDeadline = p.rows.filter((r) => r.targetYear !== null);

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: p.tenant.slug, name: p.tenant.name }} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 print:max-w-none print:px-0">
        <p className="text-sm print:hidden">
          <Link className="underline" href={href(`/${tenant}`)}>
            {fmt(m.common.back, { name: p.tenant.name })}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{fmt(m.progress.title, { name: p.tenant.name })}</h1>
        {sample ? <SampleDataNotice labels={m.sampleData} name={p.tenant.name} className="mt-4 max-w-3xl" /> : null}
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          <strong className="font-medium text-[color:var(--color-fg)]">{m.progress.baseline}</strong>{' '}
          <span lang="en">{p.config.baseline_label}</span>. {m.progress.intro}
        </p>

        {p.rows.length === 0 ? (
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">{m.progress.nothingPublished}</p>
        ) : (
          <>
            <section aria-label={m.progress.summary} className="mt-6 flex flex-wrap gap-3">
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
                {m.progress.tracked} · {fmtPlural(locale, m.progress.withDueDate, withDeadline.length)}
              </div>
            </section>

            <details className="mt-4 text-sm print:hidden">
              <summary className="cursor-pointer text-[color:var(--color-muted)]">{m.progress.statusesMeaning}</summary>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {(Object.keys(m.statusExplainer) as (keyof typeof m.statusExplainer)[]).map((s) => (
                  <div key={s}>
                    <dt className="inline font-medium">{m.status[s]}: </dt>
                    <dd className="inline">{m.statusExplainer[s]}</dd>
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
              {m.progress.gapsTitle}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">{m.progress.gapsIntro}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {p.gaps.map((g) => (
                <li key={`${g.dimensionSlug}-${g.indicator}`} className="rounded border border-dashed border-black/20 p-3">
                  <span className="font-medium">{dimensionLabel(m, g.dimensionSlug, g.dimensionName)}</span> —{' '}
                  <span lang="en">{g.indicator}</span>
                  <span lang="en" className="mt-1 block text-[color:var(--color-muted)]">
                    {g.reason.length > 280 ? `${g.reason.slice(0, 277)}…` : g.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12 border-t border-black/10 pt-6 text-sm print:hidden" aria-labelledby="open-data">
          <h2 id="open-data" className="font-semibold">
            {m.progress.openData}
          </h2>
          <p className="mt-1 text-[color:var(--color-muted)]">
            {rich(m.progress.openDataIntro, {
              files: (
                <span dir="ltr">
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
                </span>
              ),
            })}{' '}
            {rich(m.progress.methodologyLink, {
              link: (
                <Link className="underline" href={href(`/${p.tenant.slug}/methodology`)}>
                  {m.progress.thresholdsAndRationales}
                </Link>
              ),
            })}
          </p>
        </section>
      </main>
    </>
  );
}
