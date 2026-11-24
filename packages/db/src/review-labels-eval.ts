import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  APPROVAL_CAUSE,
  reviewCauseLabel,
  type FindingPayload,
  type FindingVerification,
  type ResearchModels,
  type ReviewDecision,
  type ReviewLabelCause,
  type ReviewLabelProvider,
  type StrategyName,
} from '@deep-fryer/core';
import type { DbExecutor } from './client.js';
import { dimensions, findings, reviewLabels } from './schema.js';

/**
 * Read helpers over `review_labels` (migration 0025), joined with dimension
 * slugs and finding payloads/verifications so calibration dashboards and
 * strategy evaluation scripts can score precision, top causes, and verifier
 * false-pass rates.
 *
 * Every function runs on the caller's `DbExecutor` in a single query —
 * respecting row-level security (`review_labels_editor_read`) when called
 * inside `userDb` and never opening a nested pooled connection.
 */

export interface LoadedReviewLabel {
  id: string;
  tenantId: string;
  findingId: string | null;
  runId: string;
  dimensionId: string;
  dimensionSlug: string;
  indicatorSlug: string | null;
  decision: ReviewDecision;
  cause: ReviewLabelCause;
  note: string | null;
  strategy: StrategyName | null;
  strategyVersion: number | null;
  models: ResearchModels | null;
  provider: ReviewLabelProvider;
  reviewerId: string;
  createdAt: Date;
  findingPayload: FindingPayload | null;
  findingVerification: FindingVerification | null;
}

export interface LoadTenantReviewLabelsOptions {
  dimensionSlug?: string;
  strategy?: StrategyName;
  strategyVersion?: number;
  runId?: string;
  runIds?: readonly string[];
  decisions?: readonly ReviewDecision[];
  limit?: number;
}

export interface LoadStrategyReviewSummaryOptions {
  tenantId?: string;
  strategy?: StrategyName;
  strategyVersion?: number;
  runIds?: readonly string[];
  dimensionSlug?: string;
  limit?: number;
}

export interface StrategyReviewCauseStat {
  cause: ReviewLabelCause;
  label: string;
  count: number;
  share: number;
}

export interface StrategyReviewBucket {
  strategy: StrategyName | null;
  strategyVersion: number | null;
  total: number;
  approved: number;
  confirmedPrecision: number | null;
  verifierPassedTotal: number;
  verifierFalsePasses: number;
  verifierFalsePassRate: number | null;
  topDefectCauses: StrategyReviewCauseStat[];
}

export interface StrategyReviewSummaryResult {
  rows: LoadedReviewLabel[];
  total: number;
  approved: number;
  nonApproved: number;
  confirmedPrecision: number | null;
  verifierPassedTotal: number;
  verifierFalsePasses: number;
  verifierFalsePassRate: number | null;
  topDefectCauses: StrategyReviewCauseStat[];
  byStrategy: StrategyReviewBucket[];
}

const DEFAULT_TENANT_LABEL_LIMIT = 1_000;
const MAX_TENANT_LABEL_LIMIT = 5_000;
const DEFAULT_STRATEGY_LABEL_LIMIT = 5_000;
const MAX_STRATEGY_LABEL_LIMIT = 10_000;

function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(Math.floor(raw), max));
}

function buildWhere(filters: {
  tenantId?: string;
  dimensionSlug?: string;
  strategy?: StrategyName;
  strategyVersion?: number;
  runId?: string;
  runIds?: readonly string[];
  decisions?: readonly ReviewDecision[];
}): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.tenantId) conditions.push(eq(reviewLabels.tenantId, filters.tenantId));
  if (filters.dimensionSlug) conditions.push(eq(dimensions.slug, filters.dimensionSlug));
  if (filters.strategy) conditions.push(eq(reviewLabels.strategy, filters.strategy));
  if (filters.strategyVersion !== undefined) {
    conditions.push(eq(reviewLabels.strategyVersion, filters.strategyVersion));
  }
  if (filters.runId) conditions.push(eq(reviewLabels.runId, filters.runId));
  if (filters.runIds && filters.runIds.length > 0) {
    conditions.push(inArray(reviewLabels.runId, [...filters.runIds]));
  }
  if (filters.decisions && filters.decisions.length > 0) {
    conditions.push(inArray(reviewLabels.decision, [...filters.decisions]));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function queryReviewLabels(
  db: DbExecutor,
  where: SQL | undefined,
  limit: number,
): Promise<LoadedReviewLabel[]> {
  const baseQuery = db
    .select({
      id: reviewLabels.id,
      tenantId: reviewLabels.tenantId,
      findingId: reviewLabels.findingId,
      runId: reviewLabels.runId,
      dimensionId: reviewLabels.dimensionId,
      dimensionSlug: dimensions.slug,
      indicatorSlug: findings.indicatorSlug,
      decision: reviewLabels.decision,
      cause: reviewLabels.cause,
      note: reviewLabels.note,
      strategy: reviewLabels.strategy,
      strategyVersion: reviewLabels.strategyVersion,
      models: reviewLabels.models,
      provider: reviewLabels.provider,
      reviewerId: reviewLabels.reviewerId,
      createdAt: reviewLabels.createdAt,
      findingPayload: findings.payload,
      findingVerification: findings.verification,
    })
    .from(reviewLabels)
    .innerJoin(dimensions, eq(dimensions.id, reviewLabels.dimensionId))
    .leftJoin(findings, eq(findings.id, reviewLabels.findingId));

  const filtered = where ? baseQuery.where(where) : baseQuery;
  return filtered
    .orderBy(desc(reviewLabels.createdAt), desc(reviewLabels.id))
    .limit(limit);
}

/**
 * Load one portrait's `review_labels` rows joined with dimension slugs and
 * finding payloads/verifications, newest first. Runs on the caller's executor
 * so RLS (`is_editor(tenant_id)`) applies inside `userDb`.
 */
export async function loadTenantReviewLabels(
  db: DbExecutor,
  tenantId: string,
  opts: LoadTenantReviewLabelsOptions = {},
): Promise<LoadedReviewLabel[]> {
  if (opts.runIds && opts.runIds.length === 0) return [];
  if (opts.decisions && opts.decisions.length === 0) return [];
  const limit = clampLimit(opts.limit, DEFAULT_TENANT_LABEL_LIMIT, MAX_TENANT_LABEL_LIMIT);
  const where = buildWhere({ tenantId, ...opts });
  return queryReviewLabels(db, where, limit);
}

function summarizeRows(rows: readonly LoadedReviewLabel[]): Omit<StrategyReviewBucket, 'strategy' | 'strategyVersion'> {
  let approved = 0;
  let verifierPassedTotal = 0;
  let verifierFalsePasses = 0;
  const defectCounts = new Map<ReviewLabelCause, number>();

  for (const row of rows) {
    const isApproved = row.decision === 'approve';
    if (isApproved) approved++;
    else defectCounts.set(row.cause, (defectCounts.get(row.cause) ?? 0) + 1);

    if (row.findingVerification?.content_supported === 'pass') {
      verifierPassedTotal++;
      if (!isApproved && row.cause !== APPROVAL_CAUSE) verifierFalsePasses++;
    }
  }

  const total = rows.length;
  const topDefectCauses: StrategyReviewCauseStat[] = [...defectCounts.entries()]
    .filter(([cause]) => cause !== APPROVAL_CAUSE)
    .map(([cause, count]) => ({
      cause,
      label: reviewCauseLabel(cause),
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));

  return {
    total,
    approved,
    confirmedPrecision: total > 0 ? approved / total : null,
    verifierPassedTotal,
    verifierFalsePasses,
    verifierFalsePassRate: verifierPassedTotal > 0 ? verifierFalsePasses / verifierPassedTotal : null,
    topDefectCauses,
  };
}

/**
 * Load `review_labels` across runs/strategies (optionally scoped to one
 * portrait or dimension) and return both the joined rows and a summary rollup
 * by strategy. Runs in a single query on the caller's `DbExecutor`.
 */
export async function loadStrategyReviewSummary(
  db: DbExecutor,
  opts: LoadStrategyReviewSummaryOptions = {},
): Promise<StrategyReviewSummaryResult> {
  if (opts.runIds && opts.runIds.length === 0) {
    return {
      rows: [],
      total: 0,
      approved: 0,
      nonApproved: 0,
      confirmedPrecision: null,
      verifierPassedTotal: 0,
      verifierFalsePasses: 0,
      verifierFalsePassRate: null,
      topDefectCauses: [],
      byStrategy: [],
    };
  }
  const limit = clampLimit(opts.limit, DEFAULT_STRATEGY_LABEL_LIMIT, MAX_STRATEGY_LABEL_LIMIT);
  const where = buildWhere(opts);
  const rows = await queryReviewLabels(db, where, limit);
  const overall = summarizeRows(rows);

  const buckets = new Map<string, { strategy: StrategyName | null; strategyVersion: number | null; rows: LoadedReviewLabel[] }>();
  for (const row of rows) {
    const key = `${row.strategy ?? 'unrecorded'}@${row.strategyVersion ?? 'none'}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { strategy: row.strategy, strategyVersion: row.strategyVersion, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(row);
  }

  const byStrategy: StrategyReviewBucket[] = [...buckets.values()]
    .map((b) => ({
      strategy: b.strategy,
      strategyVersion: b.strategyVersion,
      ...summarizeRows(b.rows),
    }))
    .sort((a, b) => b.total - a.total || (a.strategy ?? '').localeCompare(b.strategy ?? ''));

  return {
    rows,
    total: overall.total,
    approved: overall.approved,
    nonApproved: overall.total - overall.approved,
    confirmedPrecision: overall.confirmedPrecision,
    verifierPassedTotal: overall.verifierPassedTotal,
    verifierFalsePasses: overall.verifierFalsePasses,
    verifierFalsePassRate: overall.verifierFalsePassRate,
    topDefectCauses: overall.topDefectCauses,
    byStrategy,
  };
}
