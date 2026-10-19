import type { ProgressStatus } from '@deep-fryer/core';
import { getI18n } from '@/lib/i18n/server';

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

/** The written-out status in the reader's language (lib/i18n catalogs). */
export async function StatusChip({ status }: { status: ProgressStatus }) {
  const { m } = await getI18n();
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {m.status[status]}
    </span>
  );
}
