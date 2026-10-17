import { RUN_PHASE_LABEL, SESSION_CHIP_LABEL, type RunPhase, type SessionChip } from '@/lib/run-progress';

/*
 * The research pages' status chips. Colours are the light-theme pairs the
 * dark palette mirrors (app/theme-dark.css), and every chip says its state
 * in words — colour is never the only signal.
 */

const PHASE_CLASS: Record<RunPhase, string> = {
  unapplied: 'bg-black/5',
  queued: 'bg-amber-100 text-amber-900',
  running: 'bg-blue-100 text-blue-900',
  complete: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
};

export function RunPhaseBadge({ phase }: { phase: RunPhase }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${PHASE_CLASS[phase]}`}>{RUN_PHASE_LABEL[phase]}</span>;
}

const CHIP_CLASS: Record<SessionChip, string> = {
  queued: 'bg-black/5',
  running: 'bg-blue-100 text-blue-900',
  done: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  not_run: 'bg-black/5',
};

export function SessionChipBadge({ chip }: { chip: SessionChip }) {
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${CHIP_CLASS[chip]}`}>
      {SESSION_CHIP_LABEL[chip]}
    </span>
  );
}
