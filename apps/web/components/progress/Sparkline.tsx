/**
 * Hand-rolled inline-SVG value history (no chart lib, matching the insights
 * page's style). Points are data vintages; a hollow point marks a revision —
 * a value that changed without its vintage advancing.
 */
export interface SparkPoint {
  /** Data vintage (indicator.year) — the x axis. */
  year: number;
  value: number;
  revised: boolean;
}

export function Sparkline({
  points,
  width = 160,
  height = 36,
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const pad = 4;
  const xs = points.map((p) => p.year);
  const ys = points.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const x = (year: number) =>
    xMax === xMin ? width / 2 : pad + ((year - xMin) / (xMax - xMin)) * (width - 2 * pad);
  const y = (v: number) =>
    yMax === yMin ? height / 2 : height - pad - ((v - yMin) / (yMax - yMin)) * (height - 2 * pad);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Value history ${xMin}–${xMax}`}
      className="overflow-visible"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.6} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(p.year)}
          cy={y(p.value)}
          r={2.5}
          fill={p.revised ? 'white' : 'currentColor'}
          stroke="currentColor"
          strokeWidth={p.revised ? 1.5 : 0}
        >
          <title>
            {p.year}: {p.value}
            {p.revised ? ' (revised)' : ''}
          </title>
        </circle>
      ))}
    </svg>
  );
}
