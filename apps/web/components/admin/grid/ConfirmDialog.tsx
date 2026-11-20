'use client';

import { useEffect, useId, useRef } from 'react';

/*
 * A question that must be answered before going on ("Leave without
 * saving?"), as a native modal <dialog>: the browser keeps focus inside it,
 * makes the page behind it inert and gives focus back afterwards. Escape
 * and the first button keep things as they are; the second button does the
 * thing that cannot be taken back.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  /** The safe answer, focused first. */
  stayLabel: string;
  /** The answer that loses the changes. */
  leaveLabel: string;
  onStay: () => void;
  onLeave: () => void;
}

export function ConfirmDialog({ open, title, body, stayLabel, leaveLabel, onStay, onLeave }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      // Escape: the browser closes the dialog; that answer is "stay".
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-lg border border-black/15 bg-[color:var(--color-bg)] p-5 text-[color:var(--color-fg)] backdrop:bg-[color:var(--color-bg)]/90"
    >
      <h2 id={`${ids}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={`${ids}-body`} className="mt-2 text-sm">
        {body}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus className="min-h-11 rounded bg-black px-4 font-medium text-white" onClick={onStay}>
          {stayLabel}
        </button>
        <button type="button" className="min-h-11 rounded border border-red-700 px-4 font-medium text-red-700" onClick={onLeave}>
          {leaveLabel}
        </button>
      </div>
    </dialog>
  );
}
