import type { SeriesPoint } from '@deep-fryer/core';
import { fmt } from '@/lib/i18n/format';

/**
 * A server-rendered trend line: data points by data year, the target as a
 * dashed line, the baseline point ringed. role="img" with every value in the
 * label, so the picture is never the only way to the numbers.
 */
export function Sparkline({
  series,
  target,
  baselineYear,
  unit,
  labels,
  width = 140,
  height = 36,
}: {
  series: SeriesPoint[];
  target: number | null;
  baselineYear: number | null;
  unit: string;
  /** Catalog templates for the accessible label: `Trend: {points}`, `target {value}`. */
  labels: { trend: string; target: string };
  width?: number;
  height?: number;
}) {
  if (series.length === 0) return null;
  const values = series.map((p) => p.value).concat(target !== null ? [target] : []);
  const years = series.map((p) => p.year);
  const [minV, maxV] = [Math.min(...values), Math.max(...values)];
  const [minY, maxY] = [Math.min(...years), Math.max(...years)];
  const pad = 4;
  const x = (year: number) => (maxY === minY ? width / 2 : pad + ((year - minY) / (maxY - minY)) * (width - 2 * pad));
  const y = (v: number) => (maxV === minV ? height / 2 : height - pad - ((v - minV) / (maxV - minV)) * (height - 2 * pad));
  // Values keep one number format across languages so they match the open
  // data files (SPEC-v4 §7).
  const points = `${series.map((p) => `${p.year}: ${p.value.toLocaleString('en-US')}`).join(', ')}${unit ? ` (${unit})` : ''}`;
  const label = `${fmt(labels.trend, { points })}${target !== null ? `; ${fmt(labels.target, { value: target.toLocaleString('en-US') })}` : ''}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      {target !== null ? (
        <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
      ) : null}
      {series.length > 1 ? (
        <polyline
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.75}
          points={series.map((p) => `${x(p.year)},${y(p.value)}`).join(' ')}
        />
      ) : null}
      {series.map((p) => (
        <circle
          key={p.year}
          cx={x(p.year)}
          cy={y(p.value)}
          r={p.year === baselineYear ? 3.5 : 2.5}
          fill={p.year === baselineYear ? 'white' : 'var(--color-accent)'}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
