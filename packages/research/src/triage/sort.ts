import { isFlagged, type FindingVerification, type GeographicScale } from '@deep-fryer/core';
import {
  TRIAGE_SEVERITY_RANK,
  triageExpandsFlagged,
  triagePriorityScore,
  triageSeverity,
  type TriageAssessment,
  type TriageContext,
  type TriageSeverity,
} from './schema.js';

/**
 * Pure review-queue ordering helper (SPEC-JEV §5.3): puts the worst evidence
 * on top so human reviewers dispose of flagged and high-severity items first.
 *
 * Strictly additive / flag-expanding:
 * - Never drops, filters, hides, or auto-approves any card.
 * - Any card with an existing verifier/deterministic flag stays in the top
 *   flagged partition even if triage rated its findings `'none'`.
 */

export interface TriageSortableFinding {
  verification?: FindingVerification | null;
  triage?: TriageAssessment | null;
  payload?: {
    kind?: string;
    source_tier?: number;
    geographic_scale?: GeographicScale;
  } | null;
}

export interface ReviewCardSortable {
  findings: readonly TriageSortableFinding[];
  dimension?: { displayOrder?: number; slug?: string };
  dimensionName?: string;
}

export interface SortReviewCardsOptions {
  portraitScale?: GeographicScale;
}

interface CardRankKey {
  hasAnyFlag: number;
  hasVerifierOrDeterministicFlag: number;
  worstSeverityRank: number;
  flaggedCount: number;
  totalPriorityScore: number;
  displayOrder: number;
  name: string;
  originalIndex: number;
}

function findingContext(
  finding: TriageSortableFinding,
  portraitScale?: GeographicScale,
): TriageContext {
  return {
    ...(finding.payload?.source_tier !== undefined
      ? { claimedSourceTier: finding.payload.source_tier }
      : {}),
    ...(finding.payload?.geographic_scale
      ? { claimedScale: finding.payload.geographic_scale }
      : {}),
    ...(portraitScale ? { portraitScale } : {}),
  };
}

function cardRankKey(
  card: ReviewCardSortable,
  originalIndex: number,
  options: SortReviewCardsOptions,
): CardRankKey {
  let hasAnyFlag = 0;
  let hasVerifierOrDeterministicFlag = 0;
  let worstSeverityRank = 0;
  let flaggedCount = 0;
  let totalPriorityScore = 0;

  for (const finding of card.findings) {
    const existingFlagged = Boolean(finding.verification && isFlagged(finding.verification));
    const ctx = findingContext(finding, options.portraitScale);
    const sev: TriageSeverity = finding.triage ? triageSeverity(finding.triage, ctx) : 'none';
    const expanded = triageExpandsFlagged(existingFlagged, finding.triage, ctx);

    if (existingFlagged) {
      hasVerifierOrDeterministicFlag = 1;
      flaggedCount++;
    }
    if (expanded) hasAnyFlag = 1;
    const rank = TRIAGE_SEVERITY_RANK[sev];
    if (rank > worstSeverityRank) worstSeverityRank = rank;
    totalPriorityScore += triagePriorityScore(finding.triage, ctx);
  }

  return {
    hasAnyFlag,
    hasVerifierOrDeterministicFlag,
    worstSeverityRank,
    flaggedCount,
    totalPriorityScore,
    displayOrder: card.dimension?.displayOrder ?? Number.MAX_SAFE_INTEGER,
    name: card.dimension?.slug ?? card.dimensionName ?? '',
    originalIndex,
  };
}

/**
 * Return a new array of review cards ordered worst-first:
 * 1. Flagged cards (existing verifier/deterministic flag OR high/medium triage severity) before unflagged.
 * 2. Within the flagged partition, higher worst triage severity and existing flags rise to the top.
 * 3. Higher total triage priority score breaks ties.
 * 4. Stable fallback by dimension `displayOrder`, slug/name, and original index.
 */
export function sortReviewCardsWorstFirst<T extends ReviewCardSortable>(
  cards: readonly T[],
  options: SortReviewCardsOptions = {},
): T[] {
  return cards
    .map((card, index) => ({ card, key: cardRankKey(card, index, options) }))
    .sort((a, b) => {
      if (b.key.hasAnyFlag !== a.key.hasAnyFlag) return b.key.hasAnyFlag - a.key.hasAnyFlag;
      if (b.key.worstSeverityRank !== a.key.worstSeverityRank) {
        return b.key.worstSeverityRank - a.key.worstSeverityRank;
      }
      if (b.key.hasVerifierOrDeterministicFlag !== a.key.hasVerifierOrDeterministicFlag) {
        return b.key.hasVerifierOrDeterministicFlag - a.key.hasVerifierOrDeterministicFlag;
      }
      if (b.key.flaggedCount !== a.key.flaggedCount) return b.key.flaggedCount - a.key.flaggedCount;
      if (b.key.totalPriorityScore !== a.key.totalPriorityScore) {
        return b.key.totalPriorityScore - a.key.totalPriorityScore;
      }
      if (a.key.displayOrder !== b.key.displayOrder) return a.key.displayOrder - b.key.displayOrder;
      const nameCmp = a.key.name.localeCompare(b.key.name);
      if (nameCmp !== 0) return nameCmp;
      return a.key.originalIndex - b.key.originalIndex;
    })
    .map((entry) => entry.card);
}
