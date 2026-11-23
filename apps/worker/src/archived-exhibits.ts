import type { FindingPayload } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';
import {
  extractPageWindowExcerpt,
  extractPdfTextPages,
  type PdfExcerptQuery,
} from './text-extract.js';

/** Fixed names in a verifier's scratch directory; models never choose local paths. */
export const ARCHIVED_SNAPSHOT = 'archived-snapshot.png';
export const ARCHIVED_PDF = 'archived-source.pdf';
export const ARCHIVED_PDF_EXCERPT = 'archived-source-excerpt.txt';

export interface ArchivedExhibits {
  snapshot?: Buffer;
  pdf?: Buffer;
  pdfExcerpt?: Buffer;
  additional?: { filename: string; body: Buffer }[];
}

/** Source and action exhibits for one independent verification session. */
export async function loadFindingExhibits(
  storage: TenantStorage,
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
): Promise<{ exhibits: ArchivedExhibits; names: string[]; note: string }> {
  const excerptQuery: PdfExcerptQuery = {
    claimedValue: payload.value,
    indicatorName: payload.name,
    sourceUrl: payload.source_url,
    locatorText: [payload.source, payload.notes].filter(Boolean).join(' '),
  };
  const result = await loadArchivedExhibits(storage, payload.evidence, excerptQuery);
  const additional: NonNullable<ArchivedExhibits['additional']> = [];
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
    if (archive.note) result.note += ` Action ${index + 1}: ${archive.note}`;
  }
  if (additional.length) result.exhibits.additional = additional;
  result.note = result.note.trim();
  return result;
}

const VALID_TEXT_PATH = /^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.txt$/;

/**
 * Retrieve this finding's captured evidence through its tenant's archive.
 * Never fetch an evidence path as a URL or interpret it as a worker path.
 * An absent, invalid, or oversized archive does not lose the finding: when a
 * PDF exceeds the 32 MiB binary limit and readable text was captured beside
 * it (`evidence.text_path`), a bounded page-window / keyword-matched text
 * excerpt is mounted as `archived-source-excerpt.txt` with an explicit header
 * and disclosure note so the verifier can still inspect the cited figures.
 */
export async function loadArchivedExhibits(
  storage: TenantStorage,
  evidence: Extract<FindingPayload, { kind: 'indicator' }>['evidence'],
  excerptQuery?: PdfExcerptQuery,
): Promise<{ exhibits: ArchivedExhibits; names: string[]; note: string }> {
  const exhibits: ArchivedExhibits = {};
  const names: string[] = [];
  const notes: string[] = [];
  for (const [kind, storagePath, name, extension] of [
    ['pdf', evidence.pdf_path, ARCHIVED_PDF, 'pdf'],
    ['snapshot', evidence.snapshot_path, ARCHIVED_SNAPSHOT, 'png'],
  ] as const) {
    if (!storagePath) continue;
    // captureEvidence writes exactly evidence/<id>.png|pdf. Imported archive
    // filenames may contain dots/dashes/underscores, but no other directory.
    if (!new RegExp(`^evidence/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\\.${extension}$`).test(storagePath)) {
      notes.push(`The archived ${kind} was not loaded: invalid evidence path.`);
      continue;
    }
    try {
      const body = await storage.get(storagePath);
      if (!body.length) throw new Error('empty archive');
      exhibits[kind] = body;
      names.push(name);
    } catch (error) {
      // Do not copy storage errors (which can contain infrastructure details)
      // into a model prompt or a finding's public provenance.
      const oversized = error instanceof Error && /exceeds \d+ bytes/.test(error.message);
      if (kind === 'pdf' && oversized && evidence.text_path && VALID_TEXT_PATH.test(evidence.text_path)) {
        try {
          const textBytes = await storage.get(evidence.text_path);
          const pages = extractPdfTextPages(textBytes.toString('utf8'));
          if (pages.length > 0) {
            const excerpt = extractPageWindowExcerpt(pages, excerptQuery ?? {});
            if (excerpt.text) {
              exhibits.pdfExcerpt = Buffer.from(excerpt.text, 'utf8');
              names.push(ARCHIVED_PDF_EXCERPT);
              notes.push(
                `The archived pdf exceeds the 32 MiB archive-reading limit; a bounded text excerpt (${excerpt.pagesIncluded.length} of ${excerpt.totalPages} pages) was provided in ${ARCHIVED_PDF_EXCERPT}.`,
              );
              continue;
            }
          }
        } catch {
          // Fall through to the standard oversized-PDF disclosure note below.
        }
      }
      const reason = oversized
        ? 'it exceeds the 32 MiB archive-reading limit'
        : 'it is unavailable or empty';
      notes.push(`The archived ${kind} was not loaded: ${reason}.`);
    }
  }
  return { exhibits, names, note: notes.join(' ') };
}
