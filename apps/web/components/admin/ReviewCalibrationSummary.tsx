import type { ReviewLabelsSummary } from '@deep-fryer/research';

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Compact Review Calibration Summary panel for the admin Research page.
 * Renders only when `review_labels` exist for the portrait, surfacing
 * human-confirmed precision, verifier false-pass rate (when applicable),
 * and top rejection / edit / re-research causes.
 */
export function ReviewCalibrationSummary({ summary }: { summary: ReviewLabelsSummary }) {
  if (summary.total === 0) return null;

  const topCauses = summary.topDefectCauses.slice(0, 4);

  return (
    <section
      className="mt-4 rounded border border-black/10 p-3"
      aria-label="Review calibration"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Review calibration</h2>
        <span className="text-xs text-[color:var(--color-muted)] tabular-nums">
          {summary.total} labeled {summary.total === 1 ? 'decision' : 'decisions'}
        </span>
      </div>
      <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[color:var(--color-muted)]">Human-confirmed precision</dt>
          <dd className="font-semibold tabular-nums">
            {formatPercent(summary.confirmedPrecision)}{' '}
            <span className="text-xs font-normal text-[color:var(--color-muted)]">
              ({summary.approved} of {summary.total} approved as cited)
            </span>
          </dd>
        </div>
        {summary.verifierPassedTotal > 0 ? (
          <div>
            <dt className="text-xs text-[color:var(--color-muted)]">Verifier false-pass rate</dt>
            <dd className="font-semibold tabular-nums">
              {formatPercent(summary.verifierFalsePassRate)}{' '}
              <span className="text-xs font-normal text-[color:var(--color-muted)]">
                ({summary.verifierFalsePasses} of {summary.verifierPassedTotal} passed findings corrected)
              </span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-[color:var(--color-muted)]">Top correction causes</dt>
          <dd className="text-xs">
            {topCauses.length === 0 ? (
              <span className="text-[color:var(--color-muted)]">No rejections or edits recorded.</span>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {topCauses.map((item) => (
                  <li key={item.cause} className="tabular-nums">
                    {item.label} ({item.count})
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
