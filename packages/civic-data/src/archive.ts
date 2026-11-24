import { createHash } from 'node:crypto';
import type { TenantStorage } from '@deep-fryer/research';
import type { CivicDataResult } from './types.js';

export interface ArchivedCivicDataEvidence {
  text_path: string;
  source_url: string;
  retrieved_at: string;
  sha256: string;
  row_count: number;
  summary_preview: string;
}

export interface ArchiveCivicDataOptions {
  /** Max rows rendered in the human-readable summary table (default: 50). All rows remain in canonical JSON. */
  maxTableRows?: number;
  /** Max characters returned in `summary_preview` (default: 2000). */
  maxPreviewChars?: number;
}

/**
 * Recursively sort object keys so serialized JSON and its SHA-256 hash are
 * completely deterministic regardless of property insertion order.
 */
function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v !== undefined) {
      sorted[key] = canonicalizeValue(v);
    }
  }
  return sorted;
}

export function canonicalJsonStringify(value: unknown, indent?: number): string {
  return JSON.stringify(canonicalizeValue(value), null, indent);
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return val.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return '';
    return val
      .map((item) => {
        if (item && typeof item === 'object' && 'code' in item && 'text' in item) {
          const f = item as { code: unknown; text: unknown };
          return `${String(f.code)}:${String(f.text)}`.replace(/^:|:$/g, '');
        }
        return typeof item === 'object' ? canonicalJsonStringify(item) : String(item);
      })
      .join('; ')
      .replace(/\r?\n/g, ' ')
      .replace(/\|/g, '\\|');
  }
  return canonicalJsonStringify(val).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Flatten structured rows (including Census ACS rows whose estimate/MOE/geo
 * fields live in nested records) into a column-aligned map for table display.
 */
function flattenRowForTable(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') return { value: row };
  const record = row as Record<string, unknown>;
  if (
    'values' in record &&
    'geography' in record &&
    typeof record.values === 'object' &&
    record.values !== null &&
    typeof record.geography === 'object' &&
    record.geography !== null
  ) {
    const flat: Record<string, unknown> = {};
    if ('name' in record) flat.name = record.name;
    Object.assign(flat, record.geography as Record<string, unknown>);
    Object.assign(flat, record.values as Record<string, unknown>);
    if (typeof record.margins_of_error === 'object' && record.margins_of_error !== null) {
      Object.assign(flat, record.margins_of_error as Record<string, unknown>);
    }
    return flat;
  }
  return record;
}

function renderMarkdownTable(
  columns: readonly string[],
  rows: readonly unknown[],
  maxTableRows: number,
): string {
  if (rows.length === 0) {
    return '(0 rows returned)';
  }
  const flatRows = rows.slice(0, maxTableRows).map(flattenRowForTable);
  const cols =
    columns.length > 0
      ? [...columns]
      : [...new Set(flatRows.flatMap((r) => Object.keys(r)))];

  if (cols.length === 0) {
    return '(no columns)';
  }

  const lines: string[] = [];
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const row of flatRows) {
    lines.push(`| ${cols.map((col) => formatCell(row[col])).join(' | ')} |`);
  }
  if (rows.length > maxTableRows) {
    lines.push(`... (${rows.length - maxTableRows} additional row(s) omitted from table; see CANONICAL JSON below)`);
  }
  return lines.join('\n');
}

/**
 * Format a `CivicDataResult` into a deterministic, human-readable and
 * machine-verifiable plain-text evidence exhibit containing provenance,
 * query parameters, a summary table, and canonical sorted-key JSON.
 */
export function formatCivicDataExhibit<TRow>(
  result: CivicDataResult<TRow>,
  opts: ArchiveCivicDataOptions = {},
): { fullText: string; summaryPreview: string } {
  const maxTableRows = opts.maxTableRows ?? 50;
  const maxPreviewChars = opts.maxPreviewChars ?? 2000;

  const headerLines = [
    'CIVIC DATA API EXHIBIT',
    `Title: ${result.title}`,
    `Source: ${result.source_name}`,
    `Agency: ${result.citation.agency}`,
    `Dataset: ${result.citation.dataset}`,
    ...(result.citation.year !== undefined ? [`Year: ${String(result.citation.year)}`] : []),
    `Connector: ${result.connector}`,
    `Provenance URL: ${result.source_url}`,
    `Retrieved At: ${result.retrieved_at}`,
    `Row Count: ${result.row_count}`,
    `Truncated: ${result.truncated ? 'yes' : 'no'}`,
    `Query Parameters: ${canonicalJsonStringify(result.query_params)}`,
  ];

  if (result.notes && result.notes.length > 0) {
    headerLines.push(`Notes: ${result.notes.join(' | ')}`);
  }

  const tableBlock = renderMarkdownTable(result.columns, result.rows, maxTableRows);
  const summarySection = `${headerLines.join('\n')}\n\n--- SUMMARY TABLE ---\n${tableBlock}`;

  const canonicalPayload = {
    connector: result.connector,
    title: result.title,
    source_name: result.source_name,
    source_url: result.source_url,
    retrieved_at: result.retrieved_at,
    query_params: result.query_params,
    citation: result.citation,
    columns: result.columns,
    row_count: result.row_count,
    truncated: Boolean(result.truncated),
    notes: result.notes ?? [],
    rows: result.rows,
  };

  const fullText = `${summarySection}\n\n--- CANONICAL JSON ---\n${canonicalJsonStringify(canonicalPayload, 2)}\n`;
  const summaryPreview =
    summarySection.length <= maxPreviewChars
      ? summarySection
      : `${summarySection.slice(0, maxPreviewChars - 1)}…`;

  return { fullText, summaryPreview };
}

function isAlreadyExistsStorageError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 'EEXIST') return true;
  if (typeof e.message === 'string' && /already exists/i.test(e.message)) return true;
  return false;
}

/**
 * Archive a deterministic civic API query result into `TenantStorage` at
 * `evidence/<sha256>.txt` so every API lookup satisfies
 * `verify-against-the-archived-exhibit` deterministically.
 */
export async function archiveCivicDataResult<TRow>(
  storage: Pick<TenantStorage, 'put'>,
  result: CivicDataResult<TRow>,
  opts: ArchiveCivicDataOptions = {},
): Promise<ArchivedCivicDataEvidence> {
  const { fullText, summaryPreview } = formatCivicDataExhibit(result, opts);
  const bytes = Buffer.from(fullText, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const textPath = `evidence/${sha256}.txt`;

  try {
    await storage.put(textPath, bytes, 'text/plain; charset=utf-8');
  } catch (err) {
    // Content-addressed by the exact SHA-256 digest of `bytes`: an existing
    // object at the same path holds the identical immutable exhibit.
    if (!isAlreadyExistsStorageError(err)) {
      throw err;
    }
  }

  return {
    text_path: textPath,
    source_url: result.source_url,
    retrieved_at: result.retrieved_at,
    sha256,
    row_count: result.row_count,
    summary_preview: summaryPreview,
  };
}
