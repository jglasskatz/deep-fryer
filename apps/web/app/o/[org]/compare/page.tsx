import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { getPortrait } from '@/lib/data';
import { requireOrganizationFeature } from '@/lib/features';
import { familyByOrgSlug } from '@/lib/family';
import { dimensionLabel, localizeDimensions, nounForms } from '@/lib/i18n/content';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import type { PublishedPortrait } from '@/lib/portrait';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const [family, { m }] = await Promise.all([familyByOrgSlug((await params).org), getI18n()]);
  return { title: family ? fmt(m.compare.metaTitle, { org: family.organization.name }) : m.nav.compare };
}

export const dynamic = 'force-dynamic';

interface IndicatorRow {
  dimensionSlug: string;
  dimension: string;
  ring: string;
  indicator: string;
  unit: string;
  values: Record<string, number>; // slug -> value
  spreadPct: number;
  minSlug: string;
  maxSlug: string;
}

function buildRows(
  portraits: Record<string, PublishedPortrait>,
  whole: string | null,
): IndicatorRow[] {
  const bySlugKey = new Map<string, IndicatorRow>();
  for (const [slug, portrait] of Object.entries(portraits)) {
    for (const d of portrait.dimensions) {
      for (const ind of d.data.indicators) {
        if (typeof ind.value !== 'number') continue;
        const key = `${d.slug}::${ind.name}`;
        let row = bySlugKey.get(key);
        if (!row) {
          row = {
            dimensionSlug: d.slug,
            dimension: d.data.name,
            ring: d.ring,
            indicator: ind.name,
            unit: ind.unit,
            values: {},
            spreadPct: 0,
            minSlug: slug,
            maxSlug: slug,
          };
          bySlugKey.set(key, row);
        }
        row.values[slug] = ind.value;
      }
    }
  }

  const rows: IndicatorRow[] = [];
  for (const row of bySlugKey.values()) {
    const boroughEntries = Object.entries(row.values).filter(([s]) => s !== whole);
    if (boroughEntries.length < 3) continue; // needs a real borough contrast
    let min = boroughEntries[0]!;
    let max = boroughEntries[0]!;
    for (const e of boroughEntries) {
      if (e[1] < min[1]) min = e;
      if (e[1] > max[1]) max = e;
    }
    row.minSlug = min[0];
    row.maxSlug = max[0];
    const denom = Math.abs(min[1]) > 1e-9 ? Math.abs(min[1]) : 1;
    row.spreadPct = ((max[1] - min[1]) / denom) * 100;
    rows.push(row);
  }
  return rows.sort((a, b) => Math.abs(b.spreadPct) - Math.abs(a.spreadPct));
}

function outsideSafeCount(p: PublishedPortrait): number {
  return p.dimensions.filter((d) => (d.viz_level ?? 0) > 0).length;
}

/**
 * Family compare (SPEC v3 W1; SPEC-v4 §2): every portrait an organization
 * holds, side by side against identical thresholds, plus the indicators
 * where its members diverge most. NYC's six-doughnut view is the first
 * instance; any multi-portrait organization gets the same page.
 */
export default async function ComparePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [family, { m, href }] = await Promise.all([familyByOrgSlug(org), getI18n()]);
  if (!family || family.members.length < 2) notFound();
  // Compare and Insights are a feature (SPEC-v7 §3), on when any of the family's portraits has it.
  await requireOrganizationFeature(family.organization.id, 'family_compare');
  const FAMILY = family.members;
  const whole = family.whole;
  const { singular: noun, plural: nouns } = nounForms(m, family.noun);
  const labels = doughnutLabels(m);

  const entries = await Promise.all(
    FAMILY.map(async (m) => [m.slug, await getPortrait(m.slug)] as const),
  );
  const portraits = Object.fromEntries(
    entries.filter(([, p]) => p !== null) as [string, PublishedPortrait][],
  );
  const rows = buildRows(portraits, whole);

  return (
    <>
      <SiteHeader variant="org" family={family} familyView="compare" org={family.organization} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">
          {fmt(whole ? m.compare.titleJurisdiction : m.compare.titleFamily, {
            n: FAMILY.length,
            org: family.organization.name,
          })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          {fmt(whole ? m.compare.introJurisdiction : m.compare.introFamily, { n: FAMILY.length, noun })}
        </p>

        <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {FAMILY.map((member) => {
            const p = portraits[member.slug];
            if (!p) return null;
            return (
              <div key={member.slug} className="rounded-lg border border-black/10 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={href(`/${member.slug}`)} className="font-semibold hover:underline">
                    {member.name}
                  </Link>
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {fmt(m.compare.wedgesOutside, { n: outsideSafeCount(p), total: p.dimensions.length })}
                  </span>
                </div>
                <div className="mt-2 flex justify-center">
                  <PortraitDoughnut
                    tenantSlug={member.slug}
                    tenantName={member.name}
                    dimensions={localizeDimensions(m, p.dimensions)}
                    linkBase={`${href(`/${member.slug}`)}/dim`}
                    labels={labels}
                    size={320}
                  />
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">{fmt(m.compare.divergeTitle, { nouns })}</h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {fmt(m.compare.divergeIntro, { noun, nouns })}
            {whole ? ` ${m.compare.wholeColumn}` : ''}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15">
                  <th className="py-2 pe-3 text-start font-medium">{m.compare.indicator}</th>
                  {FAMILY.map((member) => (
                    <th key={member.slug} className="px-2 py-2 text-end font-medium">
                      {member.short}
                    </th>
                  ))}
                  <th className="py-2 ps-3 text-end font-medium">{m.compare.spread}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 14).map((row) => (
                  <tr key={`${row.dimension}-${row.indicator}`} className="border-b border-black/5">
                    <td className="py-2 pe-3">
                      <div lang="en" className="font-medium">
                        {row.indicator}
                      </div>
                      <div className="text-xs text-[color:var(--color-muted)]">
                        {dimensionLabel(m, row.dimensionSlug, row.dimension)} · <span lang="en">{row.unit}</span>
                      </div>
                    </td>
                    {FAMILY.map((member) => {
                      const v = row.values[member.slug];
                      const isMin = member.slug === row.minSlug;
                      const isMax = member.slug === row.maxSlug;
                      return (
                        <td
                          key={member.slug}
                          className={`px-2 py-2 text-end tabular-nums ${
                            member.slug === whole ? 'text-[color:var(--color-muted)]' : ''
                          } ${isMax ? 'font-semibold text-red-700' : ''} ${
                            isMin ? 'font-semibold text-green-700' : ''
                          }`}
                        >
                          {v === undefined ? (
                            '—'
                          ) : (
                            <span title={formatIndicatorValue(v, row.unit)}>
                              {Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td dir="ltr" className="py-2 ps-3 text-end tabular-nums text-[color:var(--color-muted)]">
                      {Math.abs(row.values[row.minSlug] ?? 0) < 1
                        ? `Δ ${(row.values[row.maxSlug]! - (row.values[row.minSlug] ?? 0)).toFixed(1)}`
                        : Math.abs(row.spreadPct) >= 1
                          ? `${row.spreadPct.toFixed(0)}%`
                          : '<1%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[color:var(--color-muted)]">{fmt(m.compare.legend, { noun, nouns })}</p>
        </section>
      </main>
    </>
  );
}
