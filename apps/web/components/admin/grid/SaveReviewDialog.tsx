'use client';

import { useEffect, useId, useRef } from 'react';
import { formatIndicatorValue } from '@deep-fryer/core';
import { columnChoices, readValueText } from '@/lib/spreadsheet-import';
import type { StagedChange } from './edit-session';
import type { SaveReview } from './save-warnings';

/*
 * Pre-save review modal for the data table's edit mode, built on a native
 * <dialog> like ConfirmDialog. Shows the summary of draft versions to be
 * created, every warning grouped by dimension and indicator, and each cell's
 * before/after change so the editor can confirm or go back to keep editing.
 *
 * Pure UI: calls no server action and makes no network request. The page
 * wrapper handles saving onConfirm.
 */

export interface SaveReviewDialogProps {
  open: boolean;
  review: SaveReview | null;
  changeNote: string;
  onChangeNoteChange: (note: string) => void;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function formatCellValue(change: StagedChange, raw: string, isAfter: boolean): string {
  const trimmed = raw.trim();
  if (isAfter && change.clearsValue) return 'missing data';
  if (!trimmed) return 'empty';
  const choice = columnChoices(change.column)?.find(
    (c) => c.value === trimmed.toLowerCase() || c.label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (choice) return choice.label;
  if (change.column === 'value' || change.column === 'target') {
    const parsed = readValueText(trimmed);
    if (parsed !== null) return formatIndicatorValue(parsed, '');
  }
  return trimmed;
}

export function SaveReviewDialog({
  open,
  review,
  changeNote,
  onChangeNoteChange,
  saving,
  error,
  onBack,
  onConfirm,
}: SaveReviewDialogProps) {
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
      aria-describedby={`${ids}-summary`}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onBack();
      }}
      className="m-auto w-[min(94vw,44rem)] rounded-lg border border-black/15 bg-[color:var(--color-bg)] p-5 text-[color:var(--color-fg)] backdrop:bg-[color:var(--color-bg)]/90"
    >
      {review ? (
        <>
          <h2 id={`${ids}-title`} className="text-lg font-semibold">
            Review changes before saving drafts
          </h2>
          <p id={`${ids}-summary`} className="mt-2 text-sm">
            Saving {plural(review.changeCount, 'change')} across {plural(review.indicatorCount, 'indicator')} in{' '}
            {plural(review.dimensionCount, 'dimension')} as new drafts. Nothing is published automatically — each
            dimension&apos;s draft still needs to be published separately.
          </p>
          <p className="mt-1 text-sm font-medium">
            {review.warningCount > 0 ? (
              <span className="text-amber-900">
                {plural(review.warningCount, 'warning')} to review before saving.
              </span>
            ) : (
              <span className="text-[color:var(--color-muted)]">No warnings found. Check the changes below before saving.</span>
            )}
          </p>

          {error ? (
            <div role="alert" className="mt-3 rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-medium">{error}</p>
              <p className="mt-1">Your staged edits are still in the table. Go back to fix them or try saving again.</p>
            </div>
          ) : null}

          <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto rounded border border-black/15 p-3 text-sm">
            {review.dimensions.map((dim) => (
              <section key={dim.dimensionId} aria-label={dim.dimensionName} className="space-y-2 border-b border-black/10 pb-3 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{dim.dimensionName}</h3>
                  <span className="text-xs text-[color:var(--color-muted)]">
                    v{dim.baseVersion} → v{dim.baseVersion + 1} draft
                    {dim.published ? ' · currently published' : ''}
                  </span>
                </div>

                {dim.dimensionWarnings.length > 0 ? (
                  <ul className="space-y-1 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-950">
                    {dim.dimensionWarnings.map((w, i) => (
                      <li key={`${w.kind}-${i}`} className="break-words">
                        <span className="font-semibold">Warning:</span> {w.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ul className="space-y-2">
                  {dim.indicators.map((ind) => (
                    <li key={ind.rowId} className="rounded border border-black/10 bg-white/60 p-2.5">
                      <p className="font-medium break-words">{ind.indicatorName}</p>
                      {ind.warnings.length > 0 ? (
                        <ul className="mt-1.5 space-y-1 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-950">
                          {ind.warnings.map((w, i) => (
                            <li key={`${w.kind}-${i}`} className="break-words">
                              <span className="font-semibold">Warning:</span> {w.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <dl className="mt-1.5 space-y-1 text-xs">
                        {ind.changes.map((c) => (
                          <div key={`${c.rowId}-${c.column}`} className="flex flex-wrap gap-x-1.5 break-words">
                            <dt className="font-medium">{c.columnLabel}:</dt>
                            <dd className="min-w-0 break-words">
                              <span className="text-[color:var(--color-muted)]">{formatCellValue(c, c.before, false)}</span>
                              {' → '}
                              <span className="font-medium">{formatCellValue(c, c.after, true)}</span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <label className="mt-4 block text-sm">
            <span className="font-medium">Change note (optional)</span>
            <input
              type="text"
              value={changeNote}
              maxLength={500}
              disabled={saving}
              placeholder="e.g. Updated 2024 figures from county report"
              onChange={(e) => onChangeNoteChange(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded border border-field-border bg-white px-3 text-base text-[color:var(--color-fg)] sm:text-sm disabled:opacity-50"
            />
          </label>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              autoFocus
              disabled={saving}
              className="min-h-11 rounded border border-black/20 px-4 font-medium disabled:opacity-50"
              onClick={onBack}
            >
              Go back to keep editing
            </button>
            <button
              type="button"
              disabled={saving}
              className="min-h-11 rounded bg-black px-4 font-medium text-white disabled:opacity-50"
              onClick={onConfirm}
            >
              {saving ? 'Saving drafts…' : 'Confirm & save drafts'}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
