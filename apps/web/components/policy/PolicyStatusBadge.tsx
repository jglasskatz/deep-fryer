import type { AnalysisStatusValue } from './AnalysisStatus';

const STYLE: Record<AnalysisStatusValue, string> = {
  queued: 'bg-black/5',
  running: 'bg-blue-100 text-blue-900',
  complete: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
};

/** The status as a word in a tinted chip (the word carries it; the tint only echoes it). */
export function PolicyStatusBadge({ status }: { status: AnalysisStatusValue }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${STYLE[status]}`}>{status}</span>;
}
