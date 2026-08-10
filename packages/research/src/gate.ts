import { createHash } from 'node:crypto';
import {
  isFlagged,
  type CurrentDisposition,
  type FindingPayload,
  type FindingVerification,
} from '@deep-fryer/core';

/**
 * The run-level verification gate, as a pure library. Both consumers — the
 * research-verify CLI and the /admin/verify web surface — call
 * computeGateReport() so their numbers can never disagree, and both bind
 * approvals to the same contentHash(). Stage thresholds live here and only
 * here.
 */

export const APPROVE_ACTION = 'research_verify.approve';

/** Structural row shape — satisfied by @deep-fryer/db's Finding. */
export interface GateFindingRow {
  id: string;
  sessionId: string;
  dimensionId: string;
  indicatorSlug: string;
  payload: FindingPayload;
  verification: FindingVerification | null;
}

export interface GateViolation {
  stage: 'deterministic' | 'verifier' | 'review' | 'confirmation';
  severity: 'critical' | 'warning';
  message: string;
  /** Set when the violation is about one specific finding — UI deep links. */
  findingId?: string;
}

export interface GateApprovalRecord {
  content_hash?: string;
  approved_by?: string;
  signature_meaning?: string;
  findings?: number;
  gaps?: number;
  unsupported?: number;
  uncertain?: number;
  sample_spot_checked?: string[];
}

export interface GateInput {
  run: { id: string; createdAt: Date; tenantSlug: string };
  findings: GateFindingRow[];
  /** All sessions of the run (kind 'dimension' ones are coverage-checked). */
  sessions: { id: string; dimensionId: string | null; kind: string }[];
  dimensionSlugById: Map<string, string>;
  /** dimension_versions rows with research_run_id = run.id. */
  versionsForRun: { dimensionId: string }[];
  /** audit_log rows for the tenant with ts > run.createdAt. */
  auditRowsAfterRun: { action: string; entityId: string | null; after: unknown; ts?: Date }[];
  /**
   * Current per-finding dispositions (latest row per finding). When provided,
   * stage 3 additionally enforces review-disposes-each-flag at the finding
   * level: every flagged finding needs an individual disposition, the
   * spot-check sample must be explicitly verified, and nothing may sit in
   * needs_rework. Omit only for pre-disposition callers.
   */
  dispositions?: CurrentDisposition[];
}

export interface GateRollups {
  total: number;
  indicators: number;
  gaps: number;
  supported: number;
  unsupported: number;
  uncertain: number;
  /** Rates over indicator findings, 0..1 — judged against the 5% / 25% bars. */
  failRate: number;
  uncertainRate: number;
  /** Share of indicator findings on tier 1–2 sources — judged against 50%. */
  tier12Share: number;
  tier4Plus: number;
  evidenceMissing: number;
  urlBroken: number;
  schemaFailed: number;
  missingVerification: number;
  flagged: number;
  /** Indicator findings that carry no evidence.quote (observational only). */
  quoteMissing: number;
  /** Quotes that were NOT found in the archived source text. */
  quoteMismatch: number;
}

export interface GateReport {
  violations: GateViolation[];
  hasCritical: boolean;
  hash: string;
  sample: { findingId: string; label: string }[];
  rollups: GateRollups;
  unreviewedDimensionIds: string[];
  approval: {
    state: 'none' | 'current' | 'stale';
    approvedBy?: string;
    approvedAt?: Date;
    recordedHash?: string;
    sampleSpotChecked?: string[];
  };
}

/**
 * Approval binds to exactly this: the run's findings as reviewed. The wrapper
 * key order and localeCompare sort are load-bearing — recorded hashes live in
 * audit rows, so any byte-level change strands every prior approval as stale.
 * Only hash values that round-tripped through jsonb (Postgres normalizes key
 * order deterministically; in-memory objects may not stringify identically).
 */
export function contentHash(
  rows: Pick<GateFindingRow, 'id' | 'payload' | 'verification'>[],
): string {
  const canonical = rows
    .map((f) => ({ id: f.id, payload: f.payload, verification: f.verification }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Deterministic sample of auto-passed findings (seeded by run id — ISA 530 spirit). */
export function sampleIds(ids: string[], runId: string, size: number): string[] {
  const scored = ids.map((id) => ({
    id,
    score: createHash('sha256').update(runId + id).digest('hex'),
  }));
  scored.sort((a, b) => a.score.localeCompare(b.score));
  return scored.slice(0, size).map((s) => s.id);
}

export function computeGateReport(input: GateInput): GateReport {
  const { run, findings, sessions, dimensionSlugById, dispositions } = input;
  const violations: GateViolation[] = [];
  const v = (
    stage: GateViolation['stage'],
    severity: GateViolation['severity'],
    message: string,
    findingId?: string,
  ) => violations.push({ stage, severity, message, findingId });
  const slug = (dimensionId: string) => dimensionSlugById.get(dimensionId) ?? dimensionId;
  const label = (f: GateFindingRow) => `${slug(f.dimensionId)}/${f.indicatorSlug}`;

  // ---- Stage 1: deterministic ----
  for (const s of sessions.filter((x) => x.kind === 'dimension')) {
    if (!findings.some((f) => f.sessionId === s.id)) {
      v(
        'deterministic',
        'critical',
        `session for ${s.dimensionId ? slug(s.dimensionId) : s.id} produced no findings and no gaps`,
      );
    }
  }
  const indicatorFindings = findings.filter((f) => f.payload.kind === 'indicator');
  let evidenceMissing = 0;
  let urlBroken = 0;
  let schemaFailed = 0;
  let missingVerification = 0;
  let quoteMissing = 0;
  let quoteMismatch = 0;
  for (const f of findings) {
    if (!f.verification) {
      missingVerification += 1;
      v('deterministic', 'critical', `finding ${f.indicatorSlug} has no verification record`, f.id);
      continue;
    }
    if (!f.verification.schema_ok) schemaFailed += 1;
    if (f.payload.kind === 'indicator') {
      if (!f.payload.evidence?.snapshot_path) {
        evidenceMissing += 1;
        v(
          'deterministic',
          'critical',
          `${label(f)}: no evidence snapshot (evidence-archived-at-access)`,
          f.id,
        );
      }
      if (!f.verification.url_ok) {
        urlBroken += 1;
        v(
          'deterministic',
          'warning',
          `${label(f)}: source URL did not resolve — snapshot is the surviving record; needs review disposition`,
          f.id,
        );
      }
      // Warning, never critical: image-heavy sources legitimately can't quote.
      if (!f.payload.evidence?.quote) {
        quoteMissing += 1;
      } else if (f.verification.quote_ok === false) {
        quoteMismatch += 1;
        v(
          'deterministic',
          'warning',
          `${label(f)}: supporting quote not found in the archived source text (verify-against-the-archived-exhibit)`,
          f.id,
        );
      }
    }
  }

  // ---- Stage 2: verifier verdicts ----
  const supported = indicatorFindings.filter((f) => f.verification?.content_supported === 'pass');
  const unsupported = indicatorFindings.filter((f) => f.verification?.content_supported === 'fail');
  const uncertain = indicatorFindings.filter(
    (f) => f.verification?.content_supported === 'uncertain',
  );
  const tier12 = indicatorFindings.filter(
    (f) => f.payload.kind === 'indicator' && f.payload.source_tier <= 2,
  );
  if (indicatorFindings.length > 0) {
    const failRate = unsupported.length / indicatorFindings.length;
    if (failRate > 0.05) {
      v(
        'verifier',
        'critical',
        `unsupported-claim rate ${(failRate * 100).toFixed(1)}% exceeds 5% — the run itself is suspect, prefer re-research over hand-fixing`,
      );
    } else if (unsupported.length > 0) {
      v(
        'verifier',
        'warning',
        `${unsupported.length} finding(s) contradicted by their own source — each needs individual disposition`,
      );
    }
    if (uncertain.length / indicatorFindings.length > 0.25) {
      v(
        'verifier',
        'warning',
        `verifier uncertain on ${uncertain.length}/${indicatorFindings.length} findings — sources may be paywalled or unstable`,
      );
    }
    if (tier12.length / indicatorFindings.length < 0.5) {
      v(
        'verifier',
        'warning',
        `tier-1/2 source share ${((tier12.length / indicatorFindings.length) * 100).toFixed(0)}% is below 50% (source-tiers-exhausted-in-order)`,
      );
    }
    for (const f of indicatorFindings) {
      if (f.payload.kind === 'indicator' && f.payload.source_tier >= 4) {
        v('verifier', 'warning', `${label(f)}: rests on a tier-${f.payload.source_tier} source`, f.id);
      }
    }
  }
  const gapCount = findings.filter((f) => f.payload.kind === 'gap').length;

  // ---- Stage 3: review completeness (the trigger) ----
  const dimIds = [...new Set(findings.map((f) => f.dimensionId))];
  const reviewedDims = new Set(input.versionsForRun.map((r) => r.dimensionId));
  const slugToDim = new Map([...dimensionSlugById].map(([id, s]) => [s, id]));
  for (const row of input.auditRowsAfterRun) {
    if (row.action === 'flag_gap' || row.action === 'create_human_version') {
      const dim = (row.after as { dimension?: string } | null)?.dimension;
      const match = dim ? slugToDim.get(dim) : undefined;
      if (match) reviewedDims.add(match);
    }
  }
  const unreviewed = dimIds.filter((id) => !reviewedDims.has(id));
  for (const id of unreviewed) {
    v(
      'review',
      'critical',
      `dimension '${slug(id)}' has findings awaiting disposition — review at /${run.tenantSlug}/admin/review?run=${run.id}`,
    );
  }

  const passedIds = supported.map((f) => f.id);
  const sample = sampleIds(passedIds, run.id, Math.min(3, passedIds.length)).map((id) => {
    const f = findings.find((x) => x.id === id)!;
    return { findingId: id, label: label(f) };
  });

  // Per-finding half of review-disposes-each-flag — active once the caller
  // supplies disposition state (V1+ surfaces always do).
  if (dispositions) {
    const current = new Map(dispositions.map((d) => [d.findingId, d]));
    const flaggedRows = findings.filter(
      (f) => !f.verification || isFlagged(f.verification),
    );
    for (const f of flaggedRows) {
      if (!current.has(f.id)) {
        v(
          'review',
          'critical',
          `${label(f)}: flagged finding awaits individual disposition (review-disposes-each-flag) — /${run.tenantSlug}/admin/verify/${run.id}`,
          f.id,
        );
      }
    }
    for (const d of dispositions) {
      if (d.state === 'needs_rework') {
        const f = findings.find((x) => x.id === d.findingId);
        v(
          'review',
          'critical',
          `${f ? label(f) : d.findingId}: marked needs-rework — re-research or re-disposition before approval`,
          d.findingId,
        );
      }
    }
    // Any disposition counts as inspection — rejecting a sampled finding is
    // exactly the outcome the sample exists to catch.
    for (const s of sample) {
      if (!current.has(s.findingId)) {
        v(
          'review',
          'critical',
          `${s.label}: spot-check sample finding awaits reviewer inspection (review-disposes-each-flag)`,
          s.findingId,
        );
      }
    }
  }

  // ---- Stage 4: approval state (recording an approval is the caller's act) ----
  const hash = contentHash(findings);
  const approvals = input.auditRowsAfterRun.filter(
    (r) => r.action === APPROVE_ACTION && r.entityId === run.id,
  );
  const currentApproval = approvals.find(
    (r) => (r.after as GateApprovalRecord | null)?.content_hash === hash,
  );
  const latest = currentApproval ?? approvals[approvals.length - 1];
  const latestAfter = (latest?.after ?? null) as GateApprovalRecord | null;
  const approval: GateReport['approval'] = {
    state: currentApproval ? 'current' : approvals.length > 0 ? 'stale' : 'none',
    approvedBy: latestAfter?.approved_by,
    approvedAt: latest?.ts,
    recordedHash: latestAfter?.content_hash,
    sampleSpotChecked: latestAfter?.sample_spot_checked,
  };

  const hasCriticalBeforeConfirmation = violations.some((x) => x.severity === 'critical');
  if (!hasCriticalBeforeConfirmation && approval.state !== 'current') {
    if (approval.state === 'stale') {
      v(
        'confirmation',
        'critical',
        'approval is STALE — findings changed since it was recorded (approval-binds-to-content); re-review and re-approve',
      );
    } else {
      v(
        'confirmation',
        'critical',
        `CONFIRMATION REQUIRED — checks pass and review is complete; approve at /${run.tenantSlug}/admin/verify/${run.id} or: research-verify --tenant ${run.tenantSlug} --run ${run.id} --approve --approved-by <you>`,
      );
    }
  }

  const flagged = findings.filter((f) => !f.verification || isFlagged(f.verification)).length;
  return {
    violations,
    hasCritical: violations.some((x) => x.severity === 'critical'),
    hash,
    sample,
    rollups: {
      total: findings.length,
      indicators: indicatorFindings.length,
      gaps: gapCount,
      supported: supported.length,
      unsupported: unsupported.length,
      uncertain: uncertain.length,
      failRate: indicatorFindings.length ? unsupported.length / indicatorFindings.length : 0,
      uncertainRate: indicatorFindings.length ? uncertain.length / indicatorFindings.length : 0,
      tier12Share: indicatorFindings.length ? tier12.length / indicatorFindings.length : 1,
      tier4Plus: indicatorFindings.filter(
        (f) => f.payload.kind === 'indicator' && f.payload.source_tier >= 4,
      ).length,
      evidenceMissing,
      urlBroken,
      schemaFailed,
      missingVerification,
      flagged,
      quoteMissing,
      quoteMismatch,
    },
    unreviewedDimensionIds: unreviewed,
    approval,
  };
}

/** Keel exit semantics shared by every gate consumer: 0 pass · 1 warnings · 2 blocked. */
export function gateExitCode(report: GateReport): 0 | 1 | 2 {
  if (report.hasCritical) return 2;
  return report.violations.length > 0 ? 1 : 0;
}
