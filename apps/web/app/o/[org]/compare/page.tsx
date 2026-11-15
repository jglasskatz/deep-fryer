import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { SampleDataNotice } from '@/components/sample-data/SampleDataNotice';
import { getPortrait } from '@/lib/data';
import { requireOrganizationFeature } from '@/lib/features';
import { familyByOrgSlug } from '@/lib/family';
import { dimensionLabel, localizeDimensions, nounForms } from '@/lib/i18n/content';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import type { PublishedPortrait } from '@/lib/portrait';
import { anySampleData } from '@/lib/sample-data';

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
  key: string;
  dimensionSlug: string;
  dimension: string;
  indicator: string;
  unit: string;
  year: number;
  values: Record<string, number>; // slug -> value
  directions: Record<string, 'higher_is_better' | 'lower_is_better' | null>;
  spreadPct: number;
  min: number;
  max: number;
  direction: 'higher_is_better' | 'lower_is_better' | null;
}

function buildRows(
  portraits: Record<string, PublishedPortrait>,
  whole: string | null,
): IndicatorRow[] {
  const bySlugKey = new Map<string, IndicatorRow>();
  for (const [slug, portrait] of Object.entries(portraits)) {
    for (const d of portrait.dimensions) {
      for (const ind of d.data.indicators) {
        // A shared label alone does not make two measurements comparable.
        // Unknown years/units cannot establish a common basis; do not guess
        // conversions or blend newer observations with older ones.
        if (typeof ind.value !== 'number' || !Number.isFinite(ind.value)
          || ind.year === null || !Number.isInteger(ind.year) || !ind.unit.trim()) continue;
        const key = JSON.stringify([d.ring, d.slug, ind.name, ind.unit, ind.year]);
        let row = bySlugKey.get(key);
        if (!row) {
          row = {
            key,
            dimensionSlug: d.slug,
            dimension: d.data.name,
            indicator: ind.name,
            unit: ind.unit,
            year: ind.year,
            values: {},
            directions: {},
            spreadPct: 0,
            min: ind.value,
            max: ind.value,
            direction: null,
          };
          bySlugKey.set(key, row);
        }
        row.values[slug] = ind.value;
        const direction = ind.scoring?.function;
        row.directions[slug] = direction === 'higher_is_better' || direction === 'lower_is_better'
          ? direction : null;
      }
    }
  }

  const rows: IndicatorRow[] = [];
  for (const row of bySlugKey.values()) {
    const peerEntries = Object.entries(row.values).filter(([s]) => s !== whole);
    if (peerEntries.length < 2) continue;
    row.min = Math.min(...peerEntries.map(([, value]) => value));
    row.max = Math.max(...peerEntries.map(([, value]) => value));
    if (row.min === row.max) continue; // no divergence, including jurisdiction-wide repeated figures
    const direction = row.directions[peerEntries[0]![0]] ?? null;
    row.direction = peerEntries.every(([slug]) => row.directions[slug] === direction) ? direction : null;
    const denom = Math.abs(row.min) > 1e-9 ? Math.abs(row.min) : 1;
    row.spreadPct = ((row.max - row.min) / denom) * 100;
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

  const [entries, sample] = await Promise.all([
    Promise.all(FAMILY.map(async (m) => [m.slug, await getPortrait(m.slug)] as const)),
    anySampleData(FAMILY.map((m) => m.slug)),
  ]);
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
        {/* One seeded portrait (scripts/seed-demo-data.ts) among the family labels the whole page. */}
        {sample ? (
          <SampleDataNotice labels={m.sampleData} name={family.organization.name} org className="mt-4 max-w-3xl" />
        ) : null}

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
          <h2 id="diverge-heading" className="text-xl font-semibold">
            {fmt(m.compare.divergeTitle, { nouns })}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {fmt(m.compare.divergeIntro, { noun, nouns })}
            {whole ? ` ${m.compare.wholeColumn}` : ''}
          </p>
          {/* A phone shows half this table, and nothing inside it takes focus: the box itself
              is focusable (and named by the heading) so the keyboard can scroll it in every
              browser — Safari does not make scroll containers focusable on its own. */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="diverge-heading"
            className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          >
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
                {rows.length === 0 ? (
                  <tr><td colSpan={FAMILY.length + 2} className="py-4 text-[color:var(--color-muted)]">
                    {m.compare.empty}
                  </td></tr>
                ) : null}
                {rows.slice(0, 14).map((row) => (
                  <tr key={row.key} className="border-b border-black/5">
                    <td className="py-2 pe-3">
                      <div lang="en" className="font-medium">
                        {row.indicator}
                      </div>
                      <div className="text-xs text-[color:var(--color-muted)]">
                        {dimensionLabel(m, row.dimensionSlug, row.dimension)} · <span lang="en">{row.unit}</span> · {row.year}
                      </div>
                    </td>
                    {FAMILY.map((member) => {
                      const v = row.values[member.slug];
                      const isPeer = member.slug !== whole;
                      // Color only a shared, documented monotonic direction.
                      // Unknown/conflicting/range-based scoring stays neutral;
                      // equal extremes receive the same treatment.
                      const favorable = isPeer && row.direction !== null
                        && v === (row.direction === 'higher_is_better' ? row.max : row.min);
                      const unfavorable = isPeer && row.direction !== null
                        && v === (row.direction === 'higher_is_better' ? row.min : row.max);
                      return (
                        <td
                          key={member.slug}
                          className={`px-2 py-2 text-end tabular-nums ${
                            member.slug === whole ? 'text-[color:var(--color-muted)]' : ''
                          } ${unfavorable ? 'font-semibold text-red-700' : ''} ${
                            favorable ? 'font-semibold text-green-700' : ''
                          }`}
                        >
                          {v === undefined ? (
                            '—'
                          ) : (
                            <span title={formatIndicatorValue(v, row.unit)}>
                              {formatIndicatorValue(v, '')}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td dir="ltr" className="py-2 ps-3 text-end tabular-nums text-[color:var(--color-muted)]">
                      {Math.abs(row.min) < 1
                        // Derived differences suppress floating-point subtraction noise,
                        // while the shared formatter preserves nonzero tiny values.
                        ? `Δ ${formatIndicatorValue(Number((row.max - row.min).toPrecision(15)), '')}`
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
