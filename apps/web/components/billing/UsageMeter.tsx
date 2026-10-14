/** A labeled usage bar ("Research sessions: 64 of 600"); amber past 80%, red at the limit. */
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const color = pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-[color:var(--color-accent)]';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-[color:var(--color-muted)]">{label}</span>
        <span className="tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded bg-black/10"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div className={`h-2 rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
