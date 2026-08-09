import { isFlagged } from './config.js';
import type {
  DispositionState,
  FindingPayload,
  FindingVerification,
  GapFindingPayload,
  IndicatorFindingPayload,
  ReviewAnnotation,
} from './types.js';

/**
 * Pure review-domain logic shared by the approve action, the verify gate,
 * and the verify UI — one implementation of "what has been dispositioned"
 * and "which findings materialize", so surfaces cannot disagree.
 */

/** Structural shape of a review_notes row (db-free). */
export interface ReviewNoteRow {
  findingId: string | null;
  disposition: DispositionState | null;
  annotation: ReviewAnnotation | null;
  note: string | null;
  reviewerLabel: string;
  createdAt: Date;
}

/** The effective disposition of one finding: the newest disposition row. */
export interface CurrentDisposition {
  findingId: string;
  state: DispositionState;
  note?: string;
  annotation?: ReviewAnnotation;
  reviewerLabel: string;
  at: Date;
}

/**
 * Latest-wins reducer over append-only review notes. Rows without a
 * disposition are pure commentary and never change review state.
 */
export function currentDispositions(rows: ReviewNoteRow[]): CurrentDisposition[] {
  const latest = new Map<string, CurrentDisposition>();
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of sorted) {
    if (!row.disposition || !row.findingId) continue;
    latest.set(row.findingId, {
      findingId: row.findingId,
      state: row.disposition,
      note: row.note ?? undefined,
      annotation: row.annotation ?? undefined,
      reviewerLabel: row.reviewerLabel,
      at: row.createdAt,
    });
  }
  return [...latest.values()];
}

export interface ApprovalPartition {
  /** kind 'indicator', not rejected — these materialize into the version. */
  indicators: IndicatorFindingPayload[];
  /** kind 'gap', not rejected — honest gaps carry into the version. */
  gaps: GapFindingPayload[];
  /** Finding ids excluded by a 'rejected' disposition. */
  rejected: string[];
  /** Non-empty ⇒ approval must refuse: findings sit in needs_rework. */
  blockedNeedsRework: string[];
  /**
   * Non-empty ⇒ approval must refuse: flagged findings with no individual
   * disposition (review-disposes-each-flag). A reviewer overrides the
   * verifier by dispositioning a failed finding as 'verified' — the
   * disposition note is the record of that judgment.
   */
  undispositionedFlagged: string[];
}

/**
 * The one implementation of "which findings may materialize into a dimension
 * version". Verification flags block silently-approving bad data; rejected
 * findings are excluded; needs_rework blocks the dimension outright.
 */
export function partitionForApproval(
  findings: {
    id: string;
    indicatorSlug: string;
    payload: FindingPayload;
    verification: FindingVerification | null;
  }[],
  dispositions: CurrentDisposition[],
): ApprovalPartition {
  const byId = new Map(dispositions.map((d) => [d.findingId, d]));
  const indicators: IndicatorFindingPayload[] = [];
  const gaps: GapFindingPayload[] = [];
  const rejected: string[] = [];
  const blockedNeedsRework: string[] = [];
  const undispositionedFlagged: string[] = [];

  for (const f of findings) {
    const d = byId.get(f.id);
    if (d?.state === 'needs_rework') {
      blockedNeedsRework.push(f.id);
      continue;
    }
    if (d?.state === 'rejected') {
      rejected.push(f.id);
      continue;
    }
    const flagged = !f.verification || isFlagged(f.verification);
    if (flagged && !d) {
      undispositionedFlagged.push(f.id);
      continue;
    }
    if (f.payload.kind === 'indicator') indicators.push(f.payload);
    else if (f.payload.kind === 'gap') gaps.push(f.payload);
  }

  return { indicators, gaps, rejected, blockedNeedsRework, undispositionedFlagged };
}

/**
 * Serialize a dimension's current review state for injection into the next
 * research run's prompt (verified-discoveries-seed-reruns): structured
 * dispositions and annotations travel as JSON the session can act on,
 * with reviewer prose alongside.
 */
export function renderAnnotationsForRerun(
  items: {
    indicatorSlug: string;
    disposition: CurrentDisposition | undefined;
    notes: ReviewNoteRow[];
  }[],
): string {
  const entries = items
    .map((item) => {
      const entry: Record<string, unknown> = { indicator_slug: item.indicatorSlug };
      if (item.disposition) {
        entry.disposition = item.disposition.state;
        if (item.disposition.annotation) entry.annotation = item.disposition.annotation;
        if (item.disposition.note) entry.reviewer_note = item.disposition.note;
      }
      const comments = item.notes
        .filter((n) => !n.disposition && n.note?.trim())
        .map((n) => n.note!.trim());
      if (comments.length) entry.comments = comments;
      return entry;
    })
    .filter((e) => Object.keys(e).length > 1);
  if (!entries.length) return '';
  return [
    'Machine-readable reviewer dispositions from the prior run (verified-discoveries-seed-reruns — act on these; do not rediscover from scratch):',
    JSON.stringify(entries, null, 1),
  ].join('\n');
}
