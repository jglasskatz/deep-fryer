import type { FindingPayload } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';
import {
  buildArchivedTextExcerpt,
  CAPTURED_TEXT_EXCERPT_HEADER,
  extractPageWindowExcerpt,
  extractPdfTextPages,
  OVERSIZED_PDF_EXCERPT_HEADER,
  type PdfExcerptQuery,
  type PdfExcerptResult,
} from './text-extract.js';

/** Fixed names in a verifier's scratch directory; models never choose local paths. */
export const ARCHIVED_SNAPSHOT = 'archived-snapshot.png';
export const ARCHIVED_PDF = 'archived-source.pdf';
export const ARCHIVED_PDF_EXCERPT = 'archived-source-excerpt.txt';

/** Raw PDFs above 8 MiB or 40 pages are omitted in favor of bounded extracted text excerpts. */
export const MAX_VERIFIER_PDF_BYTES = 8 * 1024 * 1024;
export const MAX_VERIFIER_PDF_PAGES = 40;

export interface ArchivedExhibits {
  snapshot?: Buffer;
  pdf?: Buffer;
  pdfExcerpt?: Buffer;
  additional?: { filename: string; body: Buffer }[];
}

export interface LoadedExhibits {
  exhibits: ArchivedExhibits;
  names: string[];
  /** Human-readable disclosure notes for the verifier prompt (includes excerpt disclosures). */
  note: string;
  /** Notes strictly for missing, invalid, or unreadable exhibits (excludes clean excerpt substitutions). */
  unreadableNote: string;
}

export interface LoadedFindingExhibits extends LoadedExhibits {
  /** Missing/unreadable exhibit notes strictly from narrative actions (never main exhibit disclosures). */
  actionArchiveNote: string;
}

/** Source and action exhibits for one independent verification session. */
export async function loadFindingExhibits(
  storage: TenantStorage,
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
): Promise<LoadedFindingExhibits> {
  const excerptQuery: PdfExcerptQuery = {
    claimedValue: payload.value,
    indicatorName: payload.name,
    sourceUrl: payload.source_url,
    locatorText: [payload.source, payload.notes].filter(Boolean).join(' '),
  };
  const result = await loadArchivedExhibits(storage, payload.evidence, excerptQuery);
  const additional: NonNullable<ArchivedExhibits['additional']> = [];
  const actionNotes: string[] = [];
  const actionUnreadableNotes: string[] = [];
  for (const [index, action] of (payload.narrative_draft?.actions ?? []).slice(0, 5).entries()) {
    const archive = await loadArchivedExhibits(storage, action.evidence, {
      indicatorName: action.text,
      sourceUrl: action.source_url,
    });
    for (const [suffix, body] of [
      ['source.pdf', archive.exhibits.pdf],
      ['source-excerpt.txt', archive.exhibits.pdfExcerpt],
      ['snapshot.png', archive.exhibits.snapshot],
    ] as const) {
      if (!body) continue;
      const filename = `action-${index + 1}-${suffix}`;
      additional.push({ filename, body });
      result.names.push(filename);
    }
    if (archive.note) actionNotes.push(`Action ${index + 1}: ${archive.note}`);
    if (archive.unreadableNote) actionUnreadableNotes.push(`Action ${index + 1}: ${archive.unreadableNote}`);
  }
  if (additional.length) result.exhibits.additional = additional;
  const note = [result.note, ...actionNotes].filter(Boolean).join(' ').trim();
  const unreadableNote = [result.unreadableNote, ...actionUnreadableNotes].filter(Boolean).join(' ').trim();
  return {
    exhibits: result.exhibits,
    names: result.names,
    note,
    unreadableNote,
    actionArchiveNote: actionUnreadableNotes.join(' ').trim(),
  };
}

const VALID_TEXT_PATH = /^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.txt$/;

/**
 * Retrieve this finding's captured evidence through its tenant's archive.
 * Never fetch an evidence path as a URL or interpret it as a worker path.
 *
 * Whenever `evidence.text_path` exists and carries readable text, a bounded
 * text excerpt (`archived-source-excerpt.txt`) is always mounted so the
 * verifier can inspect exact figures directly without Haiku/WebFetch loss.
 * Raw `archived-source.pdf` is omitted whenever it exceeds 8 MiB, 40 pages,
 * or the 32 MiB storage read cap, with a clean disclosure note that does not
 * mark the exhibit unreadable when the text excerpt is present.
 */
export async function loadArchivedExhibits(
  storage: TenantStorage,
  evidence: Extract<FindingPayload, { kind: 'indicator' }>['evidence'],
  excerptQuery?: PdfExcerptQuery,
): Promise<LoadedExhibits> {
  const exhibits: ArchivedExhibits = {};
  const names: string[] = [];
  const notes: string[] = [];
  const unreadableNotes: string[] = [];

  // Load readable text once when available so we know total page count and can
  // always mount a bounded excerpt alongside or in place of large PDFs.
  let storedText: string | null = null;
  let pdfPages: string[] = [];
  if (evidence.text_path && VALID_TEXT_PATH.test(evidence.text_path)) {
    try {
      const textBytes = await storage.get(evidence.text_path);
      const decoded = textBytes.toString('utf8');
      if (decoded.trim()) {
        storedText = decoded;
        pdfPages = extractPdfTextPages(decoded);
      }
    } catch {
      // Text copy is best-effort; continue loading binary exhibits.
    }
  }

  let mountedExcerpt = false;
  const mountExcerpt = (excerpt: PdfExcerptResult) => {
    if (!excerpt.text || mountedExcerpt) return false;
    exhibits.pdfExcerpt = Buffer.from(excerpt.text, 'utf8');
    names.push(ARCHIVED_PDF_EXCERPT);
    mountedExcerpt = true;
    return true;
  };

  // 1. PDF exhibit (with >8 MiB / >40-page / >32 MiB omission + excerpt fallback).
  if (evidence.pdf_path) {
    if (!/^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.pdf$/.test(evidence.pdf_path)) {
      const msg = 'The archived pdf was not loaded: invalid evidence path.';
      notes.push(msg);
      unreadableNotes.push(msg);
    } else if (pdfPages.length > MAX_VERIFIER_PDF_PAGES) {
      const excerpt = extractPageWindowExcerpt(pdfPages, excerptQuery ?? {}, {
        headerTitle: CAPTURED_TEXT_EXCERPT_HEADER,
        headerReason: `Original PDF has ${pdfPages.length} pages (above the ${MAX_VERIFIER_PDF_PAGES}-page direct-read limit)`,
      });
      if (mountExcerpt(excerpt)) {
        notes.push(
          `The archived pdf has ${pdfPages.length} pages (above the ${MAX_VERIFIER_PDF_PAGES}-page direct-read limit); a bounded text excerpt (${excerpt.pagesIncluded.length} of ${excerpt.totalPages} pages) was provided in ${ARCHIVED_PDF_EXCERPT}.`,
        );
      } else {
        const msg = `The archived pdf was not loaded: it has ${pdfPages.length} pages (above the ${MAX_VERIFIER_PDF_PAGES}-page direct-read limit).`;
        notes.push(msg);
        unreadableNotes.push(msg);
      }
    } else {
      try {
        const body = await storage.get(evidence.pdf_path);
        if (!body.length) throw new Error('empty archive');
        if (body.byteLength > MAX_VERIFIER_PDF_BYTES) {
          const excerpt =
            pdfPages.length > 0
              ? extractPageWindowExcerpt(pdfPages, excerptQuery ?? {}, {
                  headerTitle: CAPTURED_TEXT_EXCERPT_HEADER,
                  headerReason: 'Original PDF exceeded the 8 MiB direct-read limit',
                })
              : storedText
                ? buildArchivedTextExcerpt(storedText, excerptQuery ?? {})
                : null;
          if (excerpt && mountExcerpt(excerpt)) {
            notes.push(
              `The archived pdf exceeds the 8 MiB direct-read limit; a bounded text excerpt (${excerpt.pagesIncluded.length} of ${excerpt.totalPages} pages) was provided in ${ARCHIVED_PDF_EXCERPT}.`,
            );
          } else {
            const msg = 'The archived pdf was not loaded: it exceeds the 8 MiB direct-read limit.';
            notes.push(msg);
            unreadableNotes.push(msg);
          }
        } else {
          exhibits.pdf = body;
          names.push(ARCHIVED_PDF);
          if (storedText) {
            const excerpt = buildArchivedTextExcerpt(storedText, excerptQuery ?? {}, {
              headerTitle: CAPTURED_TEXT_EXCERPT_HEADER,
              headerReason: 'Extracted text from the archived PDF',
            });
            mountExcerpt(excerpt);
          }
        }
      } catch (error) {
        // Do not copy storage errors (which can contain infrastructure details)
        // into a model prompt or a finding's public provenance.
        const oversized = error instanceof Error && /exceeds \d+ bytes/.test(error.message);
        if (oversized && pdfPages.length > 0) {
          const excerpt = extractPageWindowExcerpt(pdfPages, excerptQuery ?? {}, {
            headerTitle: OVERSIZED_PDF_EXCERPT_HEADER,
            headerReason: 'Original PDF exceeded the 32 MiB direct archive limit',
          });
          if (mountExcerpt(excerpt)) {
            notes.push(
              `The archived pdf exceeds the 32 MiB archive-reading limit; a bounded text excerpt (${excerpt.pagesIncluded.length} of ${excerpt.totalPages} pages) was provided in ${ARCHIVED_PDF_EXCERPT}.`,
            );
          } else {
            const msg = 'The archived pdf was not loaded: it exceeds the 32 MiB archive-reading limit.';
            notes.push(msg);
            unreadableNotes.push(msg);
          }
        } else {
          const reason = oversized
            ? 'it exceeds the 32 MiB archive-reading limit'
            : 'it is unavailable or empty';
          const msg = `The archived pdf was not loaded: ${reason}.`;
          notes.push(msg);
          unreadableNotes.push(msg);
        }
      }
    }
  } else if (storedText) {
    // Non-PDF capture with readable captured page text: always mount excerpt.
    const excerpt = buildArchivedTextExcerpt(storedText, excerptQuery ?? {}, {
      headerTitle: CAPTURED_TEXT_EXCERPT_HEADER,
      headerReason: 'Extracted readable text from the captured page',
    });
    mountExcerpt(excerpt);
  }

  // 2. Snapshot exhibit.
  if (evidence.snapshot_path) {
    if (!/^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.png$/.test(evidence.snapshot_path)) {
      const msg = 'The archived snapshot was not loaded: invalid evidence path.';
      notes.push(msg);
      unreadableNotes.push(msg);
    } else {
      try {
        const body = await storage.get(evidence.snapshot_path);
        if (!body.length) throw new Error('empty archive');
        exhibits.snapshot = body;
        names.push(ARCHIVED_SNAPSHOT);
      } catch (error) {
        const oversized = error instanceof Error && /exceeds \d+ bytes/.test(error.message);
        const reason = oversized
          ? 'it exceeds the 32 MiB archive-reading limit'
          : 'it is unavailable or empty';
        const msg = `The archived snapshot was not loaded: ${reason}.`;
        notes.push(msg);
        unreadableNotes.push(msg);
      }
    }
  }

  return {
    exhibits,
    names,
    note: notes.join(' '),
    unreadableNote: unreadableNotes.join(' '),
  };
}
