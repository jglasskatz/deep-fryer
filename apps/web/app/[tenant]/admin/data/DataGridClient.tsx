'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataGrid } from '@/components/admin/grid/DataGrid';
import type { StagedChange } from '@/components/admin/grid/edit-session';
import type { DataGridState } from '@/components/admin/grid/grid-state';
import { buildSaveReview } from '@/components/admin/grid/save-warnings';
import { SaveReviewDialog } from '@/components/admin/grid/SaveReviewDialog';
import { saveGridEdits } from '@/lib/grid-actions';
import type { DimensionWithoutRows, GridRow } from '@/lib/grid-data';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DataGridClientProps {
  tenantSlug: string;
  rows: GridRow[];
  emptyDimensions: DimensionWithoutRows[];
  dimensionCount: number;
  /** True only for editors and owners; viewers stay completely read-only. */
  canEdit: boolean;
  initial?: DataGridState;
}

/**
 * Thin client wrapper around DataGrid for the Data page: hands staged edits
 * from Done into SaveReviewDialog, saves confirmed drafts through
 * saveGridEdits, keeps staged edits intact on any error, and clears the edit
 * session and refreshes the page on success.
 */
export function DataGridClient({
  tenantSlug,
  rows,
  emptyDimensions,
  dimensionCount,
  canEdit,
  initial,
}: DataGridClientProps) {
  const router = useRouter();
  const [pendingChanges, setPendingChanges] = useState<StagedChange[] | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSignal, setSavedSignal] = useState<{ seq: number; message: string } | undefined>(undefined);

  const review = useMemo(
    () => (pendingChanges ? buildSaveReview(pendingChanges, rows) : null),
    [pendingChanges, rows],
  );

  const handleDone = (changes: StagedChange[]) => {
    setSaveError(null);
    setPendingChanges(changes);
  };

  const handleBack = () => {
    if (saving) return;
    setSaveError(null);
    setPendingChanges(null);
  };

  const handleConfirm = async () => {
    if (saving || !pendingChanges || pendingChanges.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveGridEdits({
        tenantSlug,
        edits: pendingChanges.map((c) => ({
          rowId: c.rowId,
          dimensionId: c.dimensionId,
          baseVersion: c.baseVersion,
          column: c.column,
          text: c.after,
        })),
        changeNote: changeNote.trim() || undefined,
      });

      if (!result.ok) {
        setSaveError(result.error);
        return;
      }

      const { dimensions, totalIndicators, totalCells } = result.data;
      const message =
        `Saved ${plural(totalCells, 'change')} across ${plural(totalIndicators, 'indicator')} in ` +
        `${plural(dimensions.length, 'dimension')} as ${dimensions.length === 1 ? 'a new draft' : 'new drafts'}. Nothing was published.`;

      setPendingChanges(null);
      setChangeNote('');
      setSaveError(null);
      setSavedSignal((prev) => ({ seq: (prev?.seq ?? 0) + 1, message }));
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save drafts. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DataGrid
        tenantSlug={tenantSlug}
        rows={rows}
        emptyDimensions={emptyDimensions}
        dimensionCount={dimensionCount}
        canOpenDimension={canEdit}
        initial={initial}
        onDone={canEdit ? handleDone : undefined}
        savedSignal={savedSignal}
      />
      {canEdit ? (
        <SaveReviewDialog
          open={pendingChanges !== null}
          review={review}
          changeNote={changeNote}
          onChangeNoteChange={setChangeNote}
          saving={saving}
          error={saveError}
          onBack={handleBack}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
