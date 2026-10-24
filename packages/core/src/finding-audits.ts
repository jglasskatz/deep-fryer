import { z } from 'zod';
import { indicatorFindingPayloadSchema } from './validators.js';
import type { FindingPayload } from './types.js';

/** Corrections may describe the captured measurement; changing its source,
 * evidence or scoring contract requires fresh research rather than relabeling
 * an old exhibit. Numeric corrections are rescored by the application. */
export const findingCorrectionSchema = indicatorFindingPayloadSchema.pick({
  name: true, value: true, unit: true, year: true, source_tier: true,
  confidence: true, geographic_scale: true, notes: true,
}).partial().strict().refine((patch) => Object.keys(patch).length > 0, 'A correction must change at least one field.');

export const findingAuditResultSchema = z.object({
  disposition: z.enum(['approve', 'edit', 're_research', 'reject']),
  reason: z.string().trim().min(1).max(6000),
  correction: findingCorrectionSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.disposition === 'edit') !== Boolean(value.correction)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only edit dispositions require a correction.' });
  }
});

export type FindingCorrection = z.infer<typeof findingCorrectionSchema>;
export type FindingAuditResult = z.infer<typeof findingAuditResultSchema>;
export type FindingAuditSource = 'workflow' | 'tier_audit';

export interface ReviewAudit extends FindingAuditResult {
  id: string;
  findingId: string;
  source: FindingAuditSource;
  appliedAt: string | null;
  appliedVersionId: string | null;
  appliedRunId: string | null;
}

/** Both independent opinions remain visible. A conflicting recommendation
 * goes back to research; an approval never cancels a caution. */
export function auditDecision(audits: readonly FindingAuditResult[]): FindingAuditResult | null {
  if (!audits.length) return null;
  const reasons = audits.map((a) => a.reason).join('\n\n');
  if (audits.some((a) => a.disposition === 're_research')) return { disposition: 're_research', reason: reasons };
  const corrections = audits.filter((a) => a.disposition === 'edit');
  if ((corrections.length && audits.some((a) => a.disposition === 'reject')) ||
      new Set(corrections.map((a) => JSON.stringify(a.correction))).size > 1) {
    return { disposition: 're_research', reason: `Independent audits disagree. ${reasons}` };
  }
  if (audits.some((a) => a.disposition === 'reject')) return { disposition: 'reject', reason: reasons };
  if (corrections.length) return { ...corrections[0]!, reason: reasons };
  return { disposition: 'approve', reason: reasons };
}

export function applyFindingCorrection(payload: FindingPayload, correction: unknown): FindingPayload {
  if (payload.kind !== 'indicator') throw new Error('Gap corrections require fresh research.');
  return indicatorFindingPayloadSchema.parse({ ...payload, ...findingCorrectionSchema.parse(correction) });
}
