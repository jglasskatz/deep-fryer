import type { FindingPayload } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';

/** Fixed names in a verifier's scratch directory; models never choose local paths. */
export const ARCHIVED_SNAPSHOT = 'archived-snapshot.png';
export const ARCHIVED_PDF = 'archived-source.pdf';

export interface ArchivedExhibits {
  snapshot?: Buffer;
  pdf?: Buffer;
  additional?: { filename: string; body: Buffer }[];
}

/** Source and action exhibits for one independent verification session. */
export async function loadFindingExhibits(
  storage: TenantStorage,
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
): Promise<{ exhibits: ArchivedExhibits; names: string[]; note: string }> {
  const result = await loadArchivedExhibits(storage, payload.evidence);
  const additional: NonNullable<ArchivedExhibits['additional']> = [];
  for (const [index, action] of (payload.narrative_draft?.actions ?? []).slice(0, 5).entries()) {
    const archive = await loadArchivedExhibits(storage, action.evidence);
    for (const [suffix, body] of [['source.pdf', archive.exhibits.pdf], ['snapshot.png', archive.exhibits.snapshot]] as const) {
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

/**
 * Retrieve this finding's captured evidence through its tenant's archive.
 * Never fetch an evidence path as a URL or interpret it as a worker path.
 * An absent, invalid, or oversized archive does not lose the finding: the
 * verifier sees the omission and can independently inspect the cited URL.
 */
export async function loadArchivedExhibits(
  storage: TenantStorage,
  evidence: Extract<FindingPayload, { kind: 'indicator' }>['evidence'],
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
      const reason = error instanceof Error && /exceeds \d+ bytes/.test(error.message)
        ? 'it exceeds the 32 MiB archive-reading limit'
        : 'it is unavailable or empty';
      notes.push(`The archived ${kind} was not loaded: ${reason}.`);
    }
  }
  return { exhibits, names, note: notes.join(' ') };
}
