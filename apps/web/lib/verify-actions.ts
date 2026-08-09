'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import {
  reviewAnnotationSchema,
  type DispositionState,
  type ReviewAnnotation,
} from '@deep-fryer/core';
import { APPROVE_ACTION } from '@deep-fryer/research';
import { auditLog, dimensions, findings, getDb, researchSessions, reviewNotes } from '@deep-fryer/db';
import { getAuth, requireTenantRole, requireUserId } from './auth';
import { audit } from './audit';
import { verifyRun } from './verify-data';
import { VERIFY_ROLE } from './verify-guard';

async function reviewerIdentity(): Promise<{ reviewerId: string; reviewerLabel: string }> {
  const auth = await getAuth();
  const reviewerId = await requireUserId();
  return { reviewerId, reviewerLabel: auth.email ?? (auth.devMode ? 'dev-owner' : reviewerId) };
}

function cleanAnnotation(annotation: ReviewAnnotation | undefined): ReviewAnnotation | null {
  if (!annotation) return null;
  const parsed = reviewAnnotationSchema.parse(annotation);
  const entries = Object.entries(parsed).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '',
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as ReviewAnnotation) : null;
}

/**
 * Record a reviewer's verdict on one finding (review-disposes-each-flag).
 * Append-only: changing your mind appends a new row; the latest wins and the
 * history stays. Rejecting requires substance — a reason code or a note.
 */
export async function dispositionFinding(input: {
  tenantSlug: string;
  runId: string;
  findingId: string;
  state: DispositionState;
  note?: string;
  annotation?: ReviewAnnotation;
}) {
  const { tenant } = await requireTenantRole(input.tenantSlug, VERIFY_ROLE);
  const db = getDb();

  const [row] = await db
    .select({ finding: findings, tenantId: dimensions.tenantId })
    .from(findings)
    .innerJoin(dimensions, eq(findings.dimensionId, dimensions.id))
    .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
    .where(and(eq(findings.id, input.findingId), eq(researchSessions.runId, input.runId)));
  if (!row || row.tenantId !== tenant.id) {
    throw new Error('finding does not belong to this run and tenant');
  }

  const note = input.note?.trim() || null;
  const annotation = cleanAnnotation(input.annotation);
  if (input.state === 'rejected' && !note && !annotation?.reason_code) {
    throw new Error('rejecting requires a reason code or a note — attest to what is wrong');
  }

  const { reviewerId, reviewerLabel } = await reviewerIdentity();
  const [prev] = await db
    .select({ disposition: reviewNotes.disposition })
    .from(reviewNotes)
    .where(
      and(
        eq(reviewNotes.runId, input.runId),
        eq(reviewNotes.findingId, input.findingId),
        isNotNull(reviewNotes.disposition),
      ),
    )
    .orderBy(desc(reviewNotes.createdAt))
    .limit(1);

  await db.insert(reviewNotes).values({
    tenantId: tenant.id,
    runId: input.runId,
    dimensionId: row.finding.dimensionId,
    findingId: input.findingId,
    disposition: input.state,
    annotation,
    note,
    reviewerId,
    reviewerLabel,
  });

  await audit(
    tenant.id,
    'finding',
    input.findingId,
    'finding_disposition',
    prev?.disposition ? { state: prev.disposition } : null,
    {
      state: input.state,
      run_id: input.runId,
      ...(annotation?.reason_code ? { reason_code: annotation.reason_code } : {}),
    },
  );

  revalidatePath(`/${input.tenantSlug}/admin/verify/${input.runId}`);
  revalidatePath(`/${input.tenantSlug}/admin/review`);
}

/**
 * Free-standing reviewer commentary — thoughts, impressions, follow-ups — at
 * run scope or attached to one finding. Readable by every reviewer; never
 * changes review state.
 */
export async function addReviewNote(input: {
  tenantSlug: string;
  runId: string;
  findingId?: string;
  note: string;
}) {
  const { tenant } = await requireTenantRole(input.tenantSlug, VERIFY_ROLE);
  const db = getDb();

  const note = input.note.trim();
  if (!note) throw new Error('an empty note says nothing');

  let dimensionId: string | null = null;
  if (input.findingId) {
    const [row] = await db
      .select({ dimensionId: findings.dimensionId, tenantId: dimensions.tenantId })
      .from(findings)
      .innerJoin(dimensions, eq(findings.dimensionId, dimensions.id))
      .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
      .where(and(eq(findings.id, input.findingId), eq(researchSessions.runId, input.runId)));
    if (!row || row.tenantId !== tenant.id) {
      throw new Error('finding does not belong to this run and tenant');
    }
    dimensionId = row.dimensionId;
  }

  const { reviewerId, reviewerLabel } = await reviewerIdentity();
  await db.insert(reviewNotes).values({
    tenantId: tenant.id,
    runId: input.runId,
    dimensionId,
    findingId: input.findingId ?? null,
    disposition: null,
    annotation: null,
    note,
    reviewerId,
    reviewerLabel,
  });

  await audit(tenant.id, 'research_run', input.runId, 'review_note', null, {
    ...(input.findingId ? { finding_id: input.findingId } : {}),
    length: note.length,
  });

  revalidatePath(`/${input.tenantSlug}/admin/verify/${input.runId}`);
}

/**
 * Hash-bound run approval from the web (approval-binds-to-content). Writes
 * the exact audit-row shape the research-verify CLI writes, so approvals
 * recorded on either surface satisfy the other. Recomputes the gate report
 * server-side — stale UI state cannot smuggle an approval past open flags.
 */
export async function approveRun(input: { tenantSlug: string; runId: string }) {
  const { tenant } = await requireTenantRole(input.tenantSlug, VERIFY_ROLE);
  const db = getDb();

  const auth = await getAuth();
  const approvedBy = auth.email ?? (auth.devMode ? 'dev-owner' : null);
  if (!approvedBy) {
    throw new Error('approval requires a named approver — an anonymous approval attests to nothing');
  }

  const data = await verifyRun(tenant.id, input.runId);
  if (!data) throw new Error('unknown run for this tenant');
  const blocking = data.report.violations.filter(
    (v) => v.severity === 'critical' && v.stage !== 'confirmation',
  );
  if (blocking.length > 0) {
    throw new Error(
      `cannot approve: ${blocking.length} critical violation(s) open (review-disposes-each-flag) — first: ${blocking[0]!.message}`,
    );
  }
  if (data.report.approval.state === 'current') {
    throw new Error('this run is already approved at the current content hash');
  }

  const verified = data.dispositions.filter((d) => d.state === 'verified').length;
  const rejected = data.dispositions.filter((d) => d.state === 'rejected').length;
  await db.insert(auditLog).values({
    tenantId: tenant.id,
    userId: auth.userId,
    entity: 'research_run',
    entityId: input.runId,
    action: APPROVE_ACTION,
    after: {
      content_hash: data.report.hash,
      approved_by: approvedBy,
      signature_meaning: 'verified',
      findings: data.report.rollups.total,
      gaps: data.report.rollups.gaps,
      unsupported: data.report.rollups.unsupported,
      uncertain: data.report.rollups.uncertain,
      sample_spot_checked: data.report.sample.map((s) => s.label),
      dispositions: { verified, rejected },
      via: 'web',
    },
  });

  revalidatePath(`/${input.tenantSlug}/admin/verify/${input.runId}`);
  revalidatePath(`/${input.tenantSlug}/admin/verify`);
  return { contentHash: data.report.hash, approvedBy };
}
