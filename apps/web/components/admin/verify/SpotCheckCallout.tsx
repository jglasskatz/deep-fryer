import type { GateReport } from '@deep-fryer/research';

/**
 * The deterministic ISA-530-style sample of auto-passed findings. Approval
 * requires each to be explicitly verified by a human — trust in the verifier
 * is earned by inspection, not assumed.
 */
export function SpotCheckCallout({
  sample,
  dispositioned,
}: {
  sample: GateReport['sample'];
  /** finding ids whose current disposition is 'verified'. */
  dispositioned: Set<string>;
}) {
  if (sample.length === 0) return null;
  return (
    <aside className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        Spot-check sample — inspect these before approving (seeded by run id, same sample every
        time):
      </p>
      <ul className="mt-1 flex flex-wrap gap-2 text-xs">
        {sample.map((s) => (
          <li key={s.findingId}>
            <a
              className={`rounded border px-2 py-0.5 underline ${
                dispositioned.has(s.findingId)
                  ? 'border-green-300 bg-green-50 text-green-900'
                  : 'border-amber-400 text-amber-900'
              }`}
              href={`#finding-${s.findingId}`}
            >
              {s.label} {dispositioned.has(s.findingId) ? '✓' : '· open'}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
