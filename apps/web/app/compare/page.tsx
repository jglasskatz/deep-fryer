import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { FamilyNav } from '@/components/site-header/FamilyNav';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { getPortrait } from '@/lib/data';
import { NYC_FAMILY } from '@/lib/nyc-family';
import type { PublishedPortrait } from '@/lib/portrait';

export const dynamic = 'force-dynamic';

interface IndicatorRow {
  dimension: string;
  ring: string;
  indicator: string;
  unit: string;
  values: Record<string, number>; // slug -> value
  spreadPct: number;
  minSlug: string;
  maxSlug: string;
}

function buildRows(portraits: Record<string, PublishedPortrait>): IndicatorRow[] {
  const bySlugKey = new Map<string, IndicatorRow>();
  for (const [slug, portrait] of Object.entries(portraits)) {
    for (const d of portrait.dimensions) {
      for (const ind of d.data.indicators) {
        if (typeof ind.value !== 'number') continue;
        const key = `${d.slug}::${ind.name}`;
        let row = bySlugKey.get(key);
        if (!row) {
          row = {
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
    const boroughEntries = Object.entries(row.values).filter(([s]) => s !== 'nyc');
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

export default async function ComparePage() {
  const entries = await Promise.all(
    NYC_FAMILY.map(async (m) => [m.slug, await getPortrait(m.slug)] as const),
  );
  const portraits = Object.fromEntries(
    entries.filter(([, p]) => p !== null) as [string, PublishedPortrait][],
  );
  const rows = buildRows(portraits);
  const memberName = (slug: string) =>
    NYC_FAMILY.find((m) => m.slug === slug)?.short ?? slug;

  return (
    <>
      <SiteHeader variant="landing" />
      <FamilyNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-bold">Six doughnuts, one city</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          The same social foundation and ecological ceiling, measured six times: the whole city
          and each borough against identical thresholds anchored in adopted NYC law. Wedges
          pointing out overshoot the ceiling; wedges pointing in fall short of the foundation;
          gray is an honest data gap.
        </p>

        <section className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3">
          {NYC_FAMILY.map((m) => {
            const p = portraits[m.slug];
            if (!p) return null;
            return (
              <div key={m.slug} className="rounded-lg border border-black/10 p-3">
                <div className="flex items-baseline justify-between">
                  <Link href={`/${m.slug}`} className="font-semibold hover:underline">
                    {m.name}
                  </Link>
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {outsideSafeCount(p)}/{p.dimensions.length} wedges outside safe zone
                  </span>
                </div>
                <div className="mt-2 flex justify-center">
                  <PortraitDoughnut tenantSlug={m.slug} dimensions={p.dimensions} size={320} />
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Where the boroughs diverge most</h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Published indicators compared across boroughs, ranked by spread between the
            best- and worst-placed borough. The city column is the whole-city figure, not an
            average.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15 text-left">
                  <th className="py-2 pr-3 font-medium">Indicator</th>
                  {NYC_FAMILY.map((m) => (
                    <th key={m.slug} className="px-2 py-2 text-right font-medium">
                      {m.short}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-right font-medium">Spread</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 14).map((row) => (
                  <tr key={`${row.dimension}-${row.indicator}`} className="border-b border-black/5">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.indicator}</div>
                      <div className="text-xs text-[color:var(--color-muted)]">
                        {row.dimension} · {row.unit}
                      </div>
                    </td>
                    {NYC_FAMILY.map((m) => {
                      const v = row.values[m.slug];
                      const isMin = m.slug === row.minSlug;
                      const isMax = m.slug === row.maxSlug;
                      return (
                        <td
                          key={m.slug}
                          className={`px-2 py-2 text-right tabular-nums ${
                            m.slug === 'nyc' ? 'text-[color:var(--color-muted)]' : ''
                          } ${isMax ? 'font-semibold text-red-700' : ''} ${
                            isMin ? 'font-semibold text-green-700' : ''
                          }`}
                        >
                          {v === undefined ? '—' : Number.isInteger(v) ? v : v.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3 text-right tabular-nums text-[color:var(--color-muted)]">
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
          <p className="mt-3 text-xs text-[color:var(--color-muted)]">
            Red = borough furthest from the target, green = closest, for each row. Citywide-scale
            indicators (identical across boroughs) drop out of this table by construction.
          </p>
        </section>
      </main>
    </>
  );
}
