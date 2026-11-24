import { createHash } from 'node:crypto';
import {
  APPROVAL_CAUSE,
  reviewCauseLabel,
  type FindingPayload,
  type FindingVerification,
  type ResearchModels,
  type ReviewCause,
  type ReviewDecision,
  type ReviewLabelCause,
  type ReviewLabelProvider,
  type StrategyName,
} from '@deep-fryer/core';
import { extractValuePassages } from './triage/passages.js';

/**
 * Feedback & calibration engine over `review_labels` (migration 0025).
 *
 * Turns recorded human reviewer decisions (approve, edit, re-research, reject)
 * and their structured causes into:
 * 1. Strategy / model / dimension calibration metrics (human-confirmed
 *    precision, top defect causes, and verifier false-pass rate).
 * 2. Bounded, sanitized historical guidance per dimension for future research
 *    plans so known bad sources and recurring mistakes are not repeated.
 * 3. Deterministic regression fixtures exported from rejected/edited findings
 *    and their archived readable text excerpts for strategy evals.
 */

export interface ReviewLabelEvalRow {
  id?: string;
  tenantId?: string;
  findingId: string | null;
  runId: string;
  dimensionId?: string;
  dimensionSlug: string;
  indicatorSlug?: string | null;
  decision: ReviewDecision;
  cause: ReviewLabelCause;
  note: string | null;
  strategy: StrategyName | null;
  strategyVersion: number | null;
  models: ResearchModels | null;
  provider?: ReviewLabelProvider;
  createdAt?: Date | string;
  findingPayload?: FindingPayload | null;
  findingVerification?: FindingVerification | null;
  /** Optional archived readable source text (from evidence `.txt` sidecar). */
  sourceText?: string | null;
}

export interface CauseCount {
  cause: ReviewLabelCause;
  label: string;
  count: number;
  /** Share of all labeled decisions in scope. */
  share: number;
  /** Share of non-approved (defect) decisions in scope; 0 for correct_as_cited. */
  shareOfDefects: number;
}

export interface ReviewDecisionCounts {
  approve: number;
  edit: number;
  re_research: number;
  reject: number;
}

export interface ReviewLabelMetrics {
  total: number;
  approved: number;
  nonApproved: number;
  byDecision: ReviewDecisionCounts;
  /** Human-confirmed precision (`approved / total`), or null when `total === 0`. */
  confirmedPrecision: number | null;
  /** Findings in this slice where the independent verifier reported `content_supported === 'pass'`. */
  verifierPassedTotal: number;
  /** Verifier-passed findings that a human reviewer still rejected, edited, or sent to re-research. */
  verifierFalsePasses: number;
  /** `verifierFalsePasses / verifierPassedTotal`, or null when no verifier-passed findings are labeled. */
  verifierFalsePassRate: number | null;
  /** All causes (including `correct_as_cited`), sorted descending by count. */
  causes: CauseCount[];
  /** Non-approval defect causes only, sorted descending by count. */
  topDefectCauses: CauseCount[];
}

export interface ReviewLabelGroupSummary extends ReviewLabelMetrics {
  strategy: StrategyName | null;
  strategyVersion: number | null;
  strategyKey: string;
  models: ResearchModels | null;
  modelsKey: string;
  dimensionSlug: string;
}

export interface ReviewLabelStrategySummary extends ReviewLabelMetrics {
  strategy: StrategyName | null;
  strategyVersion: number | null;
  strategyKey: string;
  models: ResearchModels | null;
  modelsKey: string;
}

export interface ReviewLabelDimensionSummary extends ReviewLabelMetrics {
  dimensionSlug: string;
}

export interface ReviewLabelCauseCell {
  strategy: StrategyName | null;
  strategyVersion: number | null;
  strategyKey: string;
  models: ResearchModels | null;
  modelsKey: string;
  dimensionSlug: string;
  cause: ReviewLabelCause;
  label: string;
  count: number;
  verifierFalsePasses: number;
}

export interface ReviewLabelsSummary extends ReviewLabelMetrics {
  /** Exact 5-tuple grouping by (strategy, strategy_version, models, dimension_slug, cause). */
  byCauseCell: ReviewLabelCauseCell[];
  /** Grouped by (strategy, strategy_version, models, dimension_slug). */
  byGroup: ReviewLabelGroupSummary[];
  /** Rollup by (strategy, strategy_version, models). */
  byStrategy: ReviewLabelStrategySummary[];
  /** Rollup by dimension_slug. */
  byDimension: ReviewLabelDimensionSummary[];
  /** Breakdown of defect causes specifically among verifier false passes. */
  verifierFalsePassCauses: CauseCount[];
}

export function formatStrategyKey(strategy: StrategyName | null, strategyVersion: number | null): string {
  if (!strategy) return 'unrecorded';
  return strategyVersion !== null ? `${strategy}@${strategyVersion}` : strategy;
}

export function formatModelsKey(models: ResearchModels | null): string {
  if (!models) return 'unrecorded';
  const parts = [
    `session=${models.session_model}`,
    `subagent=${models.subagent_model ?? 'none'}`,
    `verifier=${models.verifier_model}`,
  ];
  if (models.page_reader_model) parts.push(`reader=${models.page_reader_model}`);
  return parts.join('|');
}

function isDefectRow(row: Pick<ReviewLabelEvalRow, 'decision' | 'cause'>): boolean {
  return row.decision !== 'approve' && row.cause !== APPROVAL_CAUSE;
}

function isVerifierPass(row: Pick<ReviewLabelEvalRow, 'findingVerification'>): boolean {
  return row.findingVerification?.content_supported === 'pass';
}

function isVerifierFalsePass(row: Pick<ReviewLabelEvalRow, 'decision' | 'cause' | 'findingVerification'>): boolean {
  return isVerifierPass(row) && isDefectRow(row);
}

function buildCauseCounts(
  rows: readonly ReviewLabelEvalRow[],
  total: number,
  nonApproved: number,
): { causes: CauseCount[]; topDefectCauses: CauseCount[] } {
  const counts = new Map<ReviewLabelCause, number>();
  for (const row of rows) {
    counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1);
  }
  const causes: CauseCount[] = [...counts.entries()]
    .map(([cause, count]) => ({
      cause,
      label: reviewCauseLabel(cause),
      count,
      share: total > 0 ? count / total : 0,
      shareOfDefects: cause !== APPROVAL_CAUSE && nonApproved > 0 ? count / nonApproved : 0,
    }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
  const topDefectCauses = causes.filter((c) => c.cause !== APPROVAL_CAUSE);
  return { causes, topDefectCauses };
}

function computeMetrics(rows: readonly ReviewLabelEvalRow[]): ReviewLabelMetrics {
  const byDecision: ReviewDecisionCounts = { approve: 0, edit: 0, re_research: 0, reject: 0 };
  let verifierPassedTotal = 0;
  let verifierFalsePasses = 0;

  for (const row of rows) {
    byDecision[row.decision]++;
    if (isVerifierPass(row)) {
      verifierPassedTotal++;
      if (isDefectRow(row)) verifierFalsePasses++;
    }
  }

  const total = rows.length;
  const approved = byDecision.approve;
  const nonApproved = total - approved;
  const { causes, topDefectCauses } = buildCauseCounts(rows, total, nonApproved);

  return {
    total,
    approved,
    nonApproved,
    byDecision,
    confirmedPrecision: total > 0 ? approved / total : null,
    verifierPassedTotal,
    verifierFalsePasses,
    verifierFalsePassRate: verifierPassedTotal > 0 ? verifierFalsePasses / verifierPassedTotal : null,
    causes,
    topDefectCauses,
  };
}

/**
 * Pure aggregation over `review_labels` rows: computes overall and grouped
 * human-confirmed precision, top rejection/edit/re-research causes, and
 * verifier false-pass rates across (strategy, strategy_version, models,
 * dimension_slug, cause).
 */
export function summarizeReviewLabels(rows: readonly ReviewLabelEvalRow[]): ReviewLabelsSummary {
  const overall = computeMetrics(rows);

  const groupBuckets = new Map<
    string,
    {
      strategy: StrategyName | null;
      strategyVersion: number | null;
      strategyKey: string;
      models: ResearchModels | null;
      modelsKey: string;
      dimensionSlug: string;
      rows: ReviewLabelEvalRow[];
    }
  >();
  const strategyBuckets = new Map<
    string,
    {
      strategy: StrategyName | null;
      strategyVersion: number | null;
      strategyKey: string;
      models: ResearchModels | null;
      modelsKey: string;
      rows: ReviewLabelEvalRow[];
    }
  >();
  const dimensionBuckets = new Map<string, ReviewLabelEvalRow[]>();
  const causeCellBuckets = new Map<string, ReviewLabelCauseCell>();
  const falsePassRows: ReviewLabelEvalRow[] = [];

  for (const row of rows) {
    const strategyKey = formatStrategyKey(row.strategy, row.strategyVersion);
    const modelsKey = formatModelsKey(row.models);
    const stratComposite = `${strategyKey}::${modelsKey}`;
    const groupComposite = `${stratComposite}::${row.dimensionSlug}`;
    const cellComposite = `${groupComposite}::${row.cause}`;

    let gb = groupBuckets.get(groupComposite);
    if (!gb) {
      gb = {
        strategy: row.strategy,
        strategyVersion: row.strategyVersion,
        strategyKey,
        models: row.models,
        modelsKey,
        dimensionSlug: row.dimensionSlug,
        rows: [],
      };
      groupBuckets.set(groupComposite, gb);
    }
    gb.rows.push(row);

    let sb = strategyBuckets.get(stratComposite);
    if (!sb) {
      sb = {
        strategy: row.strategy,
        strategyVersion: row.strategyVersion,
        strategyKey,
        models: row.models,
        modelsKey,
        rows: [],
      };
      strategyBuckets.set(stratComposite, sb);
    }
    sb.rows.push(row);

    let db = dimensionBuckets.get(row.dimensionSlug);
    if (!db) {
      db = [];
      dimensionBuckets.set(row.dimensionSlug, db);
    }
    db.push(row);

    const vfp = isVerifierFalsePass(row);
    if (vfp) falsePassRows.push(row);

    let cell = causeCellBuckets.get(cellComposite);
    if (!cell) {
      cell = {
        strategy: row.strategy,
        strategyVersion: row.strategyVersion,
        strategyKey,
        models: row.models,
        modelsKey,
        dimensionSlug: row.dimensionSlug,
        cause: row.cause,
        label: reviewCauseLabel(row.cause),
        count: 0,
        verifierFalsePasses: 0,
      };
      causeCellBuckets.set(cellComposite, cell);
    }
    cell.count++;
    if (vfp) cell.verifierFalsePasses++;
  }

  const byGroup: ReviewLabelGroupSummary[] = [...groupBuckets.values()]
    .map((b) => ({
      strategy: b.strategy,
      strategyVersion: b.strategyVersion,
      strategyKey: b.strategyKey,
      models: b.models,
      modelsKey: b.modelsKey,
      dimensionSlug: b.dimensionSlug,
      ...computeMetrics(b.rows),
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.strategyKey.localeCompare(b.strategyKey) ||
        a.dimensionSlug.localeCompare(b.dimensionSlug),
    );

  const byStrategy: ReviewLabelStrategySummary[] = [...strategyBuckets.values()]
    .map((b) => ({
      strategy: b.strategy,
      strategyVersion: b.strategyVersion,
      strategyKey: b.strategyKey,
      models: b.models,
      modelsKey: b.modelsKey,
      ...computeMetrics(b.rows),
    }))
    .sort((a, b) => b.total - a.total || a.strategyKey.localeCompare(b.strategyKey));

  const byDimension: ReviewLabelDimensionSummary[] = [...dimensionBuckets.entries()]
    .map(([dimensionSlug, bucketRows]) => ({
      dimensionSlug,
      ...computeMetrics(bucketRows),
    }))
    .sort((a, b) => b.nonApproved - a.nonApproved || b.total - a.total || a.dimensionSlug.localeCompare(b.dimensionSlug));

  const byCauseCell: ReviewLabelCauseCell[] = [...causeCellBuckets.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.strategyKey.localeCompare(b.strategyKey) ||
      a.dimensionSlug.localeCompare(b.dimensionSlug) ||
      a.cause.localeCompare(b.cause),
  );

  const verifierFalsePassCauses = buildCauseCounts(
    falsePassRows,
    falsePassRows.length,
    falsePassRows.length,
  ).topDefectCauses;

  return {
    ...overall,
    byCauseCell,
    byGroup,
    byStrategy,
    byDimension,
    verifierFalsePassCauses,
  };
}

// ---------------------------------------------------------------------------
// Historical portrait guidance builder (sanitized & bounded)
// ---------------------------------------------------------------------------

export const DEFAULT_GUIDANCE_MAX_CHARS = 600;

/**
 * Patterns indicative of prompt-injection attempts or template-expansion
 * payloads inside historical reviewer notes. Stripped before notes can ever
 * enter a future session prompt.
 */
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\{\{[^}]*\}\}/g,
  /<\|[^|]*\|>/g,
  /<\s*(system|assistant|user|instructions?|prompt|tool_call|function_call)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
  /<\/?\s*(?:system|assistant|user|instructions?|prompt|tool_call|function_call)\b[^>]*>/gi,
  /```[\s\S]*?```/g,
  /```/g,
  /(?:^|\b)(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|existing|system|policy)\s+(?:instructions?|rules?|prompts?|policies?|constraints?|directives?)[^.!?;]*[.!?;]?/gi,
  /(?:^|\b)(?:you\s+are\s+now|act\s+as\s+(?:a\s+)?(?:system|root|admin)|new\s+system\s+prompt|system\s*:\s*|assistant\s*:\s*|###\s*system\b)[^.!?;]*[.!?;]?/gi,
  /(?:^|\b)do\s+not\s+follow\s+(?:the\s+)?(?:instructions?|rules?|policy|prompt)[^.!?;]*[.!?;]?/gi,
];

/**
 * Strip ASCII control characters, bidi/zero-width overrides, template tags
 * (`{{...}}`), and prompt-injection patterns from a reviewer note.
 */
export function sanitizeGuidanceText(raw: string): string {
  // Replace control chars & bidi/zero-width formatting chars with spaces.
  let text = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    text = text.replace(pattern, ' ');
  }

  return text
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:\-.]+/, '')
    .trim();
}

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  const limit = maxChars - 1;
  const candidate = text.slice(0, limit);
  const lastSpace = candidate.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(limit * 0.6) ? candidate.slice(0, lastSpace) : candidate;
  return `${cut.replace(/[\s,;:\-]+$/, '')}…`;
}

function timestampMs(value: Date | string | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Build a concise, bounded (default ≤ 600 chars), sanitized historical
 * guidance note for `dimensionSlug` from prior non-approved human review
 * labels so future plans avoid repeating known bad sources or measures.
 * Returns `null` when no prior defect labels exist for that dimension.
 */
export function buildHistoricalGuidance(
  rows: readonly ReviewLabelEvalRow[],
  dimensionSlug: string,
  opts: { maxChars?: number } = {},
): string | null {
  const maxChars = Math.max(80, Math.min(opts.maxChars ?? DEFAULT_GUIDANCE_MAX_CHARS, 1200));
  const defects = rows
    .filter((r) => r.dimensionSlug === dimensionSlug && isDefectRow(r))
    .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));

  if (defects.length === 0) return null;

  const causeCounts = new Map<ReviewCause, number>();
  for (const d of defects) {
    const c = d.cause as ReviewCause;
    causeCounts.set(c, (causeCounts.get(c) ?? 0) + 1);
  }
  const topCauses = [...causeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([cause, count]) => `${reviewCauseLabel(cause)} (${count})`)
    .join(', ');

  const header = `Prior review feedback for ${dimensionSlug} (${defects.length} ${defects.length === 1 ? 'issue' : 'issues'}): ${topCauses}.`;

  // Collect deduplicated, sanitized reviewer notes (newest first).
  const seenNotes = new Set<string>();
  const noteParts: string[] = [];
  for (const d of defects) {
    if (!d.note) continue;
    const clean = sanitizeGuidanceText(d.note);
    if (!clean) continue;
    const dedupKey = clean.toLowerCase();
    if (seenNotes.has(dedupKey)) continue;
    seenNotes.add(dedupKey);
    const indicator = d.indicatorSlug ? `${sanitizeGuidanceText(d.indicatorSlug)}: ` : '';
    const snippet = truncateAtBoundary(`${indicator}${clean}`, 160);
    noteParts.push(snippet);
    if (noteParts.length >= 4) break;
  }

  const combined = noteParts.length > 0 ? `${header} Notes: ${noteParts.join('; ')}` : header;
  return truncateAtBoundary(combined, maxChars);
}

// ---------------------------------------------------------------------------
// Deterministic regression fixture exporter
// ---------------------------------------------------------------------------

export interface RejectedFixture {
  fixture_id: string;
  finding_id: string | null;
  run_id: string;
  dimension_slug: string;
  indicator_slug: string | null;
  decision: Exclude<ReviewDecision, 'approve'>;
  cause: ReviewCause;
  cause_label: string;
  note: string | null;
  strategy: StrategyName | null;
  strategy_version: number | null;
  models: ResearchModels | null;
  verifier_passed: boolean | null;
  finding: FindingPayload | null;
  verification: FindingVerification | null;
  text_path: string | null;
  source_text_excerpt: string | null;
}

function stableFixtureId(row: ReviewLabelEvalRow): string {
  const key = [
    row.findingId ?? 'none',
    row.runId,
    row.dimensionSlug,
    row.indicatorSlug ?? '',
    row.decision,
    row.cause,
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function buildSourceExcerpt(row: ReviewLabelEvalRow, maxExcerptChars: number): string | null {
  if (!row.sourceText || !row.sourceText.trim()) return null;
  const payload = row.findingPayload;
  if (payload && payload.kind !== 'gap') {
    const extracted = extractValuePassages({
      sourceText: row.sourceText,
      value: payload.value,
      indicatorName: payload.name,
      indicatorSlug: payload.indicator_slug,
      unit: payload.unit,
      maxTotalChars: maxExcerptChars,
    });
    const joined = extracted.passages.map((p) => p.text).join('\n\n---\n\n');
    return joined.length <= maxExcerptChars ? joined : joined.slice(0, maxExcerptChars);
  }
  const normalized = row.sourceText.replace(/\r\n?/g, '\n').trim();
  return normalized.length <= maxExcerptChars ? normalized : normalized.slice(0, maxExcerptChars);
}

/**
 * Export deterministic JSON regression fixtures from rejected, edited, or
 * re-researched findings and their archived `.txt` excerpts for strategy evals.
 */
export function exportRejectedFixtures(
  rows: readonly ReviewLabelEvalRow[],
  opts: { maxExcerptChars?: number } = {},
): RejectedFixture[] {
  const maxExcerptChars = Math.max(200, opts.maxExcerptChars ?? 6_000);
  const rejected = rows.filter(isDefectRow);

  const fixtures: RejectedFixture[] = rejected.map((row) => {
    const payload = row.findingPayload ?? null;
    const verification = row.findingVerification ?? null;
    const textPath = payload && payload.kind !== 'gap' ? (payload.evidence.text_path ?? null) : null;
    const verifierPassed = verification ? verification.content_supported === 'pass' : null;
    const indicatorSlug = row.indicatorSlug ?? payload?.indicator_slug ?? null;

    return {
      fixture_id: stableFixtureId(row),
      finding_id: row.findingId,
      run_id: row.runId,
      dimension_slug: row.dimensionSlug,
      indicator_slug: indicatorSlug,
      decision: row.decision as Exclude<ReviewDecision, 'approve'>,
      cause: row.cause as ReviewCause,
      cause_label: reviewCauseLabel(row.cause),
      note: row.note ? row.note.trim() || null : null,
      strategy: row.strategy,
      strategy_version: row.strategyVersion,
      models: row.models,
      verifier_passed: verifierPassed,
      finding: payload,
      verification,
      text_path: textPath,
      source_text_excerpt: buildSourceExcerpt(row, maxExcerptChars),
    };
  });

  // Deterministic ordering for stable CI fixture snapshots.
  return fixtures.sort(
    (a, b) =>
      a.dimension_slug.localeCompare(b.dimension_slug) ||
      (a.indicator_slug ?? '').localeCompare(b.indicator_slug ?? '') ||
      (a.finding_id ?? '').localeCompare(b.finding_id ?? '') ||
      a.cause.localeCompare(b.cause) ||
      a.decision.localeCompare(b.decision) ||
      a.fixture_id.localeCompare(b.fixture_id),
  );
}
