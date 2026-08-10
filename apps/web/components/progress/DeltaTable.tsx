import type { DimensionDelta, IndicatorChangeKind } from '@deep-fryer/core';

/**
 * First-era → last-era delta per dimension, with the vintage rule made
 * visible: arrows only where the data vintage advanced (progress/regress);
 * same-vintage changes wear a gray "revised" chip — an edit is not progress.
 */

const KIND_CHIP: Record<IndicatorChangeKind, { label: string; cls: string }> = {
  progress: { label: '▲ progress', cls: 'bg-green-100 text-green-900' },
  regress: { label: '▼ regress', cls: 'bg-red-100 text-red-900' },
  revised: { label: 'revised', cls: 'bg-black/10' },
  unchanged: { label: 'unchanged', cls: 'bg-black/5 text-[color:var(--color-muted)]' },
  new: { label: 'new', cls: 'bg-blue-100 text-blue-900' },
  removed: { label: 'removed', cls: 'bg-black/10' },
};

function fmt(side: { value: number | string | null; year: number | null } | undefined): string {
  if (!side || side.value === null || side.value === undefined) return '—';
  return `${side.value}${side.year ? ` (${side.year})` : ''}`;
}

export function DeltaTable({
  deltas,
  fromLabel,
  toLabel,
}: {
  deltas: DimensionDelta[];
  fromLabel: string;
  toLabel: string;
}) {
  const interesting = deltas.filter((d) =>
    d.indicators.some((i) => i.kind !== 'unchanged'),
  );
  return (
    <section>
      <h2 className="text-lg font-semibold">
        What changed · {fromLabel} → {toLabel}
      </h2>
      <p className="mt-1 text-sm text-[color:var(--color-muted)]">
        Arrows appear only when an indicator&rsquo;s data vintage advanced — a corrected or
        re-scored value with the same vintage is marked <em>revised</em>, never progress.
      </p>
      {interesting.length === 0 ? (
        <p className="mt-4 text-sm text-[color:var(--color-muted)]">
          No indicator-level changes between these snapshots.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {interesting.map((d) => (
            <details key={d.slug} className="rounded-lg border border-black/15 p-3" open={d.indicators.some((i) => i.kind === 'progress' || i.kind === 'regress')}>
              <summary className="cursor-pointer text-sm font-medium">
                {d.name}
                <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">
                  {d.ring}
                  {d.vizDelta !== null && d.vizDelta !== 0
                    ? ` · wedge ${d.vizDelta < 0 ? 'improved' : 'worsened'} (${d.fromViz} → ${d.toViz})`
                    : ''}
                </span>
              </summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[color:var(--color-muted)]">
                    <th className="py-1 pr-2 font-normal">Indicator</th>
                    <th className="py-1 pr-2 font-normal">{fromLabel}</th>
                    <th className="py-1 pr-2 font-normal">{toLabel}</th>
                    <th className="py-1 font-normal">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {d.indicators
                    .filter((i) => i.kind !== 'unchanged')
                    .map((i) => (
                      <tr key={i.name} className="border-t border-black/10">
                        <td className="py-1 pr-2">{i.name}</td>
                        <td className="py-1 pr-2">{fmt(i.from)}</td>
                        <td className="py-1 pr-2">
                          {fmt(i.to)}
                          {i.unit ? ` ${i.unit}` : ''}
                        </td>
                        <td className="py-1">
                          <span className={`rounded px-1.5 py-0.5 ${KIND_CHIP[i.kind].cls}`}>
                            {KIND_CHIP[i.kind].label}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
