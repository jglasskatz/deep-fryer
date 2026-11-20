import type { NamedRow, SpreadsheetImport } from '@/lib/spreadsheet-import';

/*
 * What reading an uploaded file did, in plain words: how many changes it
 * staged, and every part of the file that was not read and why (rows the
 * table has that the file does not, rows saved again since the download,
 * changes to columns a file cannot change, lines and columns that match
 * nothing).
 */

export interface UploadOutcome {
  fileName: string;
  /** Changes the upload staged (cells whose text differs from the table). */
  staged: number;
  report: SpreadsheetImport;
}

/** Names shown before "and N more". */
const LIST_AT_MOST = 8;

function listed<T>(items: readonly T[], word: (item: T) => string): string {
  const shown = items.slice(0, LIST_AT_MOST).map(word);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join('; ')}; and ${more} more` : shown.join('; ');
}

const rowName = (r: NamedRow) => `${r.dimensionName}: ${r.name}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lines = (ns: readonly number[]) => (ns.length === 1 ? `Line ${ns[0]}` : `Lines ${listed(ns, String)}`);

/** The sentences the report shows, first the outcome and then each part not read. Exported for tests. */
export function uploadReportLines({ fileName, staged, report }: UploadOutcome): { outcome: string; notes: string[] } {
  if (report.problem) return { outcome: `Nothing was read from ${fileName}. ${report.problem}`, notes: [] };
  const notRead =
    report.staleRows.length +
    report.ignoredChanges.length +
    report.unmatchedRows.length +
    report.rowsWithoutId.length +
    report.repeatedRows.length +
    report.unknownColumns.length +
    report.repeatedColumns.length;
  const outcome =
    staged > 0
      ? `${plural(staged, 'change', 'changes')} from ${fileName} ${staged === 1 ? 'is' : 'are'} now in the table, highlighted. Nothing is saved until you press Done.`
      : report.readRows === 0 && report.staleRows.length === 0 && report.unmatchedRows.length > 0
        ? `None of the rows in ${fileName} are in this table, so nothing changed. Is it the download of another portrait?`
        : notRead > 0
          ? `Nothing in the table changed. Parts of ${fileName} were not read; they are listed below.`
          : `${fileName} has nothing different from the table, so nothing changed.`;
  const notes: string[] = [];
  if (report.staleRows.length > 0) {
    notes.push(
      `${plural(report.staleRows.length, 'row was', 'rows were')} saved again by someone after this file was downloaded, so ${
        report.staleRows.length === 1 ? 'it was' : 'they were'
      } not read: ${listed(report.staleRows, rowName)}. Download the table again to change ${report.staleRows.length === 1 ? 'it' : 'them'}.`,
    );
  }
  if (report.ignoredChanges.length > 0) {
    const n = report.ignoredChanges.length;
    notes.push(
      `${plural(n, 'row has', 'rows have')} a different Dimension, Status or Evidence in the file. These columns cannot be changed from a file, so those cells were not read: ${listed(
        report.ignoredChanges,
        (r) => `${rowName(r)} (${r.columns.join(', ')})`,
      )}. Status is worked out from the value and the target.`,
    );
  }
  if (report.missingRows.length > 0) {
    notes.push(
      `${plural(report.missingRows.length, 'row of the table is', 'rows of the table are')} not in the file. Nothing changes for ${
        report.missingRows.length === 1 ? 'it' : 'them'
      }: ${listed(report.missingRows, rowName)}.`,
    );
  }
  if (report.unmatchedRows.length > 0) {
    notes.push(
      `${lines(report.unmatchedRows.map((r) => r.line))} ${
        report.unmatchedRows.length === 1 ? 'has a Row ID' : 'have Row IDs'
      } this table does not have, so ${report.unmatchedRows.length === 1 ? 'it was' : 'they were'} not read.`,
    );
  }
  if (report.rowsWithoutId.length > 0) {
    notes.push(
      `${lines(report.rowsWithoutId)} ${report.rowsWithoutId.length === 1 ? 'has' : 'have'} no Row ID, so ${
        report.rowsWithoutId.length === 1 ? 'it' : 'they'
      } could not be matched to an indicator and ${report.rowsWithoutId.length === 1 ? 'was' : 'were'} not read.`,
    );
  }
  if (report.repeatedRows.length > 0) {
    notes.push(
      `${lines(report.repeatedRows.map((r) => r.line))} repeat${report.repeatedRows.length === 1 ? 's' : ''} a row an earlier line has; only the first line for each row was read.`,
    );
  }
  if (report.unknownColumns.length > 0) {
    notes.push(
      `${report.unknownColumns.length === 1 ? 'This column is' : 'These columns are'} not part of the table, so ${
        report.unknownColumns.length === 1 ? 'it was' : 'they were'
      } not read: ${listed(report.unknownColumns, (c) => `“${c}”`)}.`,
    );
  }
  if (report.repeatedColumns.length > 0) {
    notes.push(
      `${report.repeatedColumns.length === 1 ? 'This column appears' : 'These columns appear'} twice; only the first was read: ${listed(
        report.repeatedColumns,
        (c) => `“${c}”`,
      )}.`,
    );
  }
  return { outcome, notes };
}

export function UploadReport({ outcome, onClose }: { outcome: UploadOutcome; onClose: () => void }) {
  const { outcome: first, notes } = uploadReportLines(outcome);
  const failed = Boolean(outcome.report.problem);
  return (
    <div
      className={`mt-3 rounded border p-3 text-sm ${failed ? 'border-red-700 bg-red-50' : 'border-black/15 bg-white'}`}
      role={failed ? 'alert' : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium">{first}</p>
        <button type="button" className="min-h-11 rounded border border-black/20 px-3" onClick={onClose}>
          Close
        </button>
      </div>
      {notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 ps-5">
          {notes.map((note) => (
            <li key={note} className="break-words">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
