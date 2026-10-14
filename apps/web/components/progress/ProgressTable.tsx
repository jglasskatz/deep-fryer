import Link from 'next/link';
import { formatIndicatorValue } from '@deep-fryer/core';
import type { ProgressRow } from '@/lib/progress';
import { safeHref } from '@/lib/safe-url';
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
export function ProgressTable({ tenantSlug, rows }: { tenantSlug: string; rows: ProgressRow[] }) {
  const rings = [
    ['social', 'Social foundation'],
    ['ecological', 'Ecological ceiling'],
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
                  <tr className="border-b border-black/15 text-left text-xs text-[color:var(--color-muted)]">
                    <th className="py-2 pr-3 font-medium">Indicator</th>
                    <th className="py-2 pr-3 font-medium">Baseline</th>
                    <th className="py-2 pr-3 font-medium">Latest</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {ringRows.map((r, i) => {
                    const firstOfDim = i === 0 || ringRows[i - 1]!.dimensionSlug !== r.dimensionSlug;
                    return (
                      <tr key={`${r.dimensionSlug}-${r.indicator}`} className="border-b border-black/5 align-top">
                        <td className="py-2 pr-3">
                          {firstOfDim ? (
                            <Link
                              href={`/${tenantSlug}/dim/${r.dimensionSlug}`}
                              className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)] hover:underline"
                            >
                              {r.dimensionName}
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
                                ? ` · ${r.geographicScale} figure`
                                : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.baseline ? (
                            <>
                              {formatIndicatorValue(r.baseline.value, r.unit)}
                              <span className="block text-xs text-[color:var(--color-muted)]">
                                {r.baseline.year}
                                {r.baselineIsFallback ? ' (earliest)' : ''}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.current && r.baseline && r.current.year !== r.baseline.year ? (
                            <>
                              {formatIndicatorValue(r.current.value, r.unit)}
                              <span className="block text-xs text-[color:var(--color-muted)]">
                                {r.current.year} · {signed(r.changeSinceBaseline ?? 0, r.unit)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[color:var(--color-muted)]">{r.current ? 'same as baseline' : '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.target !== null ? (
                            <>
                              {formatIndicatorValue(r.target, r.unit)}
                              {r.targetYear ? (
                                <span className="block text-xs text-[color:var(--color-muted)]">by {r.targetYear}</span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusChip status={r.status} />
                          {r.requiredAnnualChange !== null && r.status !== 'met' ? (
                            <span className="mt-1 block text-xs text-[color:var(--color-muted)]">
                              needs {signed(r.requiredAnnualChange, r.unit)} a year
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">
                          <Sparkline
                            series={r.series}
                            target={r.target}
                            baselineYear={r.baseline?.year ?? null}
                            unit={r.unit}
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
