import Link from 'next/link';
import { formatIndicatorValue } from '@deep-fryer/core';
import type { ProgressRow } from '@/lib/progress';
import { safeHref } from '@/lib/safe-url';
import { dimensionLabel, scaleLabel } from '@/lib/i18n/content';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import { Sparkline } from './Sparkline';
import { StatusChip } from './StatusChip';

function signed(n: number, unit: string): string {
  if (n === 0) return `±0`;
  return `${n > 0 ? '+' : '−'}${formatIndicatorValue(Math.abs(n), unit)}`;
}

/**
 * One portrait's indicators: baseline → latest → target, status, trend, and
 * the pace still required. Grouped by ring then dimension, linking each
 * dimension to its public drilldown (evidence and discussion).
 */
export async function ProgressTable({ tenantSlug, rows }: { tenantSlug: string; rows: ProgressRow[] }) {
  const { m, href } = await getI18n();
  const c = m.progress.columns;
  const rings = [
    ['social', m.common.socialFoundation],
    ['ecological', m.common.ecologicalCeiling],
  ] as const;
  return (
    <div className="space-y-10">
      {rings.map(([ring, title]) => {
        const ringRows = rows.filter((r) => r.ring === ring);
        if (ringRows.length === 0) return null;
        return (
          <section key={ring} aria-labelledby={`ring-${ring}`}>
            <h2 id={`ring-${ring}`} className="text-xl font-semibold">
              {title}
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/15 text-start text-xs text-[color:var(--color-muted)]">
                    <th className="py-2 pe-3 text-start font-medium">{c.indicator}</th>
                    <th className="py-2 pe-3 text-start font-medium">{c.baseline}</th>
                    <th className="py-2 pe-3 text-start font-medium">{c.latest}</th>
                    <th className="py-2 pe-3 text-start font-medium">{c.target}</th>
                    <th className="py-2 pe-3 text-start font-medium">{c.status}</th>
                    <th className="py-2 pe-3 text-start font-medium">{c.trend}</th>
                  </tr>
                </thead>
                <tbody>
                  {ringRows.map((r, i) => {
                    const firstOfDim = i === 0 || ringRows[i - 1]!.dimensionSlug !== r.dimensionSlug;
                    return (
                      <tr key={`${r.dimensionSlug}-${r.indicator}`} className="border-b border-black/5 align-top">
                        <td className="py-2 pe-3">
                          {firstOfDim ? (
                            <Link
                              href={href(`/${tenantSlug}/dim/${r.dimensionSlug}`)}
                              className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)] hover:underline"
                            >
                              {dimensionLabel(m, r.dimensionSlug, r.dimensionName)}
                            </Link>
                          ) : null}
                          <span className="font-medium">{r.indicator}</span>
                          {r.source ? (
                            <span className="block text-xs text-[color:var(--color-muted)]">
                              {safeHref(r.sourceUrl) ? (
                                <a className="underline" href={safeHref(r.sourceUrl)} target="_blank" rel="noreferrer">
                                  {r.source}
                                </a>
                              ) : (
                                r.source
                              )}
                              {r.geographicScale && r.geographicScale !== 'city' && r.geographicScale !== 'county'
                                ? ` · ${fmt(m.progress.scaleFigure, { scale: scaleLabel(m, r.geographicScale) })}`
                                : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pe-3 tabular-nums">
                          {r.baseline ? (
                            <>
                              {formatIndicatorValue(r.baseline.value, r.unit)}
                              <span className="block text-xs text-[color:var(--color-muted)]">
                                {r.baseline.year}
                                {r.baselineIsFallback ? ` ${m.progress.earliest}` : ''}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pe-3 tabular-nums">
                          {r.current && r.baseline && r.current.year !== r.baseline.year ? (
                            <>
                              {formatIndicatorValue(r.current.value, r.unit)}
                              <span className="block text-xs text-[color:var(--color-muted)]">
                                {r.current.year} · {signed(r.changeSinceBaseline ?? 0, r.unit)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[color:var(--color-muted)]">{r.current ? m.progress.sameAsBaseline : '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pe-3 tabular-nums">
                          {r.target !== null ? (
                            <>
                              {formatIndicatorValue(r.target, r.unit)}
                              {r.targetYear ? (
                                <span className="block text-xs text-[color:var(--color-muted)]">
                                  {fmt(m.progress.byYear, { year: r.targetYear })}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pe-3">
                          <StatusChip status={r.status} />
                          {r.requiredAnnualChange !== null && r.status !== 'met' ? (
                            <span className="mt-1 block text-xs text-[color:var(--color-muted)]">
                              {fmt(m.progress.needsPerYear, { change: signed(r.requiredAnnualChange, r.unit) })}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pe-3">
                          <Sparkline
                            series={r.series}
                            target={r.target}
                            baselineYear={r.baseline?.year ?? null}
                            unit={r.unit}
                            labels={{ trend: m.progress.trend, target: m.progress.trendTarget }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
