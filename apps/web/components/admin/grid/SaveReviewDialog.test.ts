import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TABLE_COLUMNS } from '@/lib/grid-columns';
import { gridRows } from '@/lib/grid-data';
import { EMPTY_SESSION, stageCells, stagedChanges } from './edit-session';
import { buildSaveReview } from './save-warnings';
import { SaveReviewDialog, type SaveReviewDialogProps } from './SaveReviewDialog';
import { santaCruzFixture } from './test-fixture';

vi.stubGlobal('React', React);

const rows = gridRows(santaCruzFixture(), { evidenceHref: (p) => `/files/santa-cruz/${p}` });
const rowsById = new Map(rows.map((r) => [r.rowId, r]));

function makeReview(writes: { rowId: string; column: string; text: string }[]) {
  const session = stageCells(EMPTY_SESSION, rowsById, writes as never, 'test');
  return buildSaveReview(stagedChanges(session, rows, TABLE_COLUMNS), rows);
}

function renderDialog(props: Partial<SaveReviewDialogProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SaveReviewDialog, {
      open: true,
      review: makeReview([
        { rowId: 'food/food-insecurity-rate', column: 'value', text: '25' },
        { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://example.org/2025' },
        { rowId: 'health/uninsured-rate', column: 'value', text: '' },
      ]),
      changeNote: '',
      onChangeNoteChange: () => {},
      saving: false,
      error: null,
      onBack: () => {},
      onConfirm: () => {},
      ...props,
    }),
  );
}

describe('SaveReviewDialog', () => {
  it('renders an accessible modal dialog with summary counts, warnings grouped by dimension/indicator, and diffs', () => {
    const html = renderDialog();
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="[^"]+-title"[^>]*aria-describedby="[^"]+-summary"/);
    expect(html).toContain('Review changes before saving drafts');
    expect(html).toContain('Saving 3 changes across 2 indicators in 2 dimensions as new drafts.');
    expect(html).toContain('Nothing is published automatically');
    expect(html).toContain('4 warnings to review before saving.');

    // Dimension headings and draft transitions
    expect(html).toContain('Food');
    expect(html).toContain('v2 → v3 draft · currently published');
    expect(html).toContain('Health');
    // Warnings rendered clearly
    expect(html).toContain('Large numeric change: 12.4 to 25 (102% increase)');
    expect(html).toContain('Clears the numeric value 5.1, turning this indicator into missing data (a gap).');
    // Before/after diffs
    expect(html).toContain('12.4</span> → <span class="font-medium">25</span>');
    expect(html).toContain('5.1</span> → <span class="font-medium">missing data</span>');
    // Both action buttons
    expect(html).toContain('Go back to keep editing');
    expect(html).toContain('Confirm &amp; save drafts');
  });

  it('surfaces server errors inside a role="alert" banner while reassuring staged edits are preserved', () => {
    const html = renderDialog({ error: 'Food was updated since this table loaded (now v3, expected v2).' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Food was updated since this table loaded (now v3, expected v2).');
    expect(html).toContain('Your staged edits are still in the table.');
  });

  it('disables controls and shows saving state while a save is in progress', () => {
    const html = renderDialog({ saving: true });
    expect(html).toContain('Saving drafts…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Go back to keep editing<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Saving drafts…<\/button>/);
  });

  it('shows a clean no-warnings message when editing an unpublished draft with complete provenance', () => {
    const html = renderDialog({
      review: makeReview([{ rowId: 'housing/cost-burdened-renters', column: 'confidence', text: 'medium' }]),
    });
    expect(html).toContain('No warnings found.');
    expect(html).toContain('High</span> → <span class="font-medium">Medium</span>');
  });

  it('uses no internal column or schema names in visible text', () => {
    const text = renderDialog().replace(/<[^>]+>/g, ' ');
    for (const internal of ['source_url', 'supporting_source_url', 'geographic_scale', 'base_version', 'level_pct']) {
      expect(text).not.toContain(internal);
    }
  });
});
