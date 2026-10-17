import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue, summarizeProgress, type ProgressStatus } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { SampleDataNotice } from '@/components/sample-data/SampleDataNotice';
import { StatusChip } from '@/components/progress/StatusChip';
import { familyByOrgSlug } from '@/lib/family';
import { anySampleData } from '@/lib/sample-data';
import { tenantProgress, type ProgressRow } from '@/lib/progress';
import { dimensionLabel, nounForms } from '@/lib/i18n/content';
import { fmt, fmtPlural, rich } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const [family, { m }] = await Promise.all([familyByOrgSlug((await params).org), getI18n()]);
  return { title: family ? fmt(m.familyProgress.metaTitle, { org: family.organization.name }) : m.nav.progress };
}

const GOOD: ProgressStatus[] = ['met', 'on_track', 'improving'];
const BAD: ProgressStatus[] = ['off_track', 'worsening'];

/**
 * Family progress (SPEC-v4 §4): every adopted goal × every portrait. For NYC
 * this answers the question a borough-level doughnut exists to answer —
 * which boroughs are keeping pace with citywide law, and which are not.
 */
export default async function FamilyProgressPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [family, { m, locale, href }] = await Promise.all([familyByOrgSlug(org), getI18n()]);
  if (!family) notFound();
  const { singular: noun } = nounForms(m, family.noun);

  const [progress, sample] = await Promise.all([
    Promise.all(family.members.map((m) => tenantProgress(m.slug))),
    anySampleData(family.members.map((m) => m.slug)),
  ]);
  const byMember = new Map(
    family.members.map((m, i) => [m.slug, new Map((progress[i]?.rows ?? []).map((r) => [`${r.dimensionSlug}::${r.indicator}`, r]))]),
  );

  // Row order: the whole-jurisdiction portrait's, then anything only members carry.
  const order: { key: string; row: ProgressRow }[] = [];
  const seen = new Set<string>();
  const ordered = [...family.members].sort((a, b) => (a.slug === family.whole ? -1 : b.slug === family.whole ? 1 : 0));
  for (const m of ordered) {
    for (const [key, row] of byMember.get(m.slug) ?? []) {
      if (seen.has(key)) continue;
      seen.add(key);
      order.push({ key, row });
    }
  }
  order.sort((a, b) =>
    a.row.ring !== b.row.ring ? (a.row.ring === 'social' ? -1 : 1) : a.row.displayOrder - b.row.displayOrder,
  );
  // Indicators with no target anywhere carry no status; keep the matrix to goals.
  const goals = order.filter(({ key }) =>
    family.members.some((m) => {
      const r = byMember.get(m.slug)?.get(key);
      return r && r.status !== 'no_target';
    }),
  );
  const baselineLabel = progress.find((p) => p)?.config.baseline_label ?? '—';

  return (
    <>
      <SiteHeader variant="org" family={family.members.length > 1 ? family : null} familyView="progress" org={family.organization} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">{fmt(m.familyProgress.title, { org: family.organization.name })}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          {rich(family.members.length === 1 ? m.familyProgress.introOne : m.familyProgress.introMany, {
            noun,
            baseline: <span lang="en">{baselineLabel}</span>,
          })}
        </p>
        {/* One seeded portrait (scripts/seed-demo-data.ts) among the family labels the whole page. */}
        {sample ? (
          <SampleDataNotice labels={m.sampleData} name={family.organization.name} org className="mt-4 max-w-3xl" />
        ) : null}

        <section
          className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={m.familyProgress.summaryByPortrait}
        >
          {family.members.map((member, i) => {
            const rows = progress[i]?.rows ?? [];
            const c = summarizeProgress(rows);
            const good = GOOD.reduce((n, s) => n + c[s], 0);
            const bad = BAD.reduce((n, s) => n + c[s], 0);
            return (
              <Link
                key={member.slug}
                href={href(`/${member.slug}/progress`)}
                className="rounded-lg border border-black/10 p-4 hover:bg-black/[0.02]"
              >
                <div className="font-semibold">{member.name}</div>
                <div className="mt-1 text-sm">
                  <span className="text-green-800">{fmtPlural(locale, m.familyProgress.onCourse, good)}</span>
                  {' · '}
                  <span className="text-red-800">{fmtPlural(locale, m.familyProgress.slipping, bad)}</span>
                  {' · '}
                  <span className="text-[color:var(--color-muted)]">
                    {fmtPlural(locale, m.familyProgress.baselineOnly, c.baseline_only)}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>

        <section className="mt-10" aria-labelledby="matrix">
          <h2 id="matrix" className="text-xl font-semibold">
            {fmt(m.familyProgress.matrixTitle, { noun })}
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15 text-xs">
                  <th className="py-2 pe-3 text-start font-medium">{m.familyProgress.goal}</th>
                  {family.members.map((member) => (
                    <th key={member.slug} className="px-2 py-2 text-start font-medium">
                      <Link href={href(`/${member.slug}/progress`)} className="hover:underline" title={member.name}>
                        {member.short}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {goals.map(({ key, row }) => (
                  <tr key={key} className="border-b border-black/5 align-top">
                    <td className="py-2 pe-3">
                      <span className="block text-xs text-[color:var(--color-muted)]">
                        {dimensionLabel(m, row.dimensionSlug, row.dimensionName)}
                      </span>
                      <span lang="en" className="font-medium">
                        {row.indicator}
                      </span>
                      {row.target !== null ? (
                        <span className="block text-xs text-[color:var(--color-muted)]">
                          {row.targetYear
                            ? fmt(m.familyProgress.targetBy, {
                                value: formatIndicatorValue(row.target, row.unit),
                                year: row.targetYear,
                              })
                            : fmt(m.familyProgress.target, { value: formatIndicatorValue(row.target, row.unit) })}
                        </span>
                      ) : null}
                    </td>
                    {family.members.map((member) => {
                      const r = byMember.get(member.slug)?.get(key);
                      return (
                        <td key={member.slug} className="px-2 py-2">
                          {r ? (
                            <>
                              <StatusChip status={r.status} />
                              {r.current ? (
                                <span className="mt-1 block text-xs tabular-nums text-[color:var(--color-muted)]">
                                  {formatIndicatorValue(r.current.value, r.unit)} ({r.current.year})
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-[color:var(--color-muted)]">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {goals.length === 0 ? (
                  <tr>
                    <td colSpan={family.members.length + 1} className="py-4 text-[color:var(--color-muted)]">
                      {m.familyProgress.nothingPublished}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
