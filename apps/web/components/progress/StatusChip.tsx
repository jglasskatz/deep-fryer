import { PROGRESS_STATUS_LABEL, type ProgressStatus } from '@deep-fryer/core';

/** Status is always written out, never conveyed by color alone (WCAG 1.4.1). */
const STYLE: Record<ProgressStatus, string> = {
  met: 'bg-green-700 text-white',
  on_track: 'bg-green-100 text-green-900',
  improving: 'bg-teal-100 text-teal-900',
  off_track: 'bg-amber-100 text-amber-900',
  worsening: 'bg-red-100 text-red-900',
  no_change: 'bg-black/10 text-black/80',
  baseline_only: 'bg-sky-100 text-sky-900',
  no_target: 'bg-black/5 text-black/70',
  no_data: 'border border-dashed border-black/30 text-black/60',
};

export function StatusChip({ status }: { status: ProgressStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {PROGRESS_STATUS_LABEL[status]}
    </span>
  );
}

export const STATUS_EXPLAINER: Partial<Record<ProgressStatus, string>> = {
  met: 'At or past the adopted target.',
  on_track: 'Moving toward the target at least as fast as a straight line from the baseline to the due date.',
  off_track: 'Improving, but slower than the pace the due date requires.',
  improving: 'Closer to the target than at the baseline (the goal has no due date).',
  worsening: 'Further from the target than at the baseline.',
  baseline_only: 'Only the baseline measurement exists so far; the next refresh will show the trend.',
};
