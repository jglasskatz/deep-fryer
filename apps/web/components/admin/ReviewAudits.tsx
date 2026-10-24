'use client';
import { useState } from 'react';
import Link from 'next/link';
import { auditDecision, formatIndicatorValue, type FindingPayload, type ReviewAudit } from '@deep-fryer/core';
import { applyMachineAudits } from '@/lib/machine-audit-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';

const dispositionLabel = { approve: 'Approve as draft', edit: 'Correct the finding', re_research: 'Plan re-research', reject: 'Replace with a data gap' };
export function AuditOpinions({ audits }: { audits: ReviewAudit[] }) {
  if (!audits.length) return null;
  return <section className="mt-2 rounded border border-black/10 p-3" aria-label="Independent audit opinions">
    <h4 className="text-sm font-semibold">Independent audit opinions</h4>
    <ul className="mt-2 space-y-3">{audits.map(audit => <li key={audit.id} className="text-xs">
      <p className="font-medium">{audit.source === 'workflow' ? 'Workflow audit' : 'Source-tier audit'} · {dispositionLabel[audit.disposition]}{audit.appliedAt ? ' · Applied' : ''}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[color:var(--color-muted)]">{audit.reason}</p>
      {audit.correction ? <dl className="mt-1 space-y-1">{Object.entries(audit.correction).map(([key, value]) => <div key={key} className="flex flex-wrap gap-x-2"><dt className="font-medium">{key.replaceAll('_', ' ')}:</dt><dd className="break-words">{value === null ? 'Not recorded' : String(value)}</dd></div>)}</dl> : null}
    </li>)}</ul>
  </section>;
}

interface AuditedFinding { id: string; indicatorSlug: string; payload: FindingPayload; audits: ReviewAudit[] }
export function AuditApplyPreview({ tenantSlug, runId, dimensionId, findings }: { tenantSlug: string; runId: string; dimensionId: string; findings: AuditedFinding[] }) {
  const { run, pending, error } = useAction();
  const [result, setResult] = useState<{ versionId?: string; versionNum?: number; runId?: string } | null>(null);
  const expectedAuditIds = findings.flatMap(finding => finding.audits.filter(audit => !audit.appliedAt).map(audit => audit.id));
  const changes = findings.flatMap(finding => {
    const decision = auditDecision(finding.audits.filter(audit => !audit.appliedAt));
    return decision ? [{ finding, decision }] : [];
  });
  if (!expectedAuditIds.length && !result) return null;
  return <section className="mt-4 rounded border border-black/15 bg-black/[0.02] p-3" aria-label="Apply audit recommendations">
    <details>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Preview audit recommendations ({changes.length} findings)</summary>
      <p className="mt-2 text-xs text-[color:var(--color-muted)]">Review both opinions and the changes below. Conflicting recommendations return to research. Applying creates a draft version or an unapplied research plan. Existing context and actions are retained.</p>
      <ul className="mt-3 space-y-3">{changes.map(({ finding, decision }) => <li key={finding.id} className="rounded border border-black/10 p-3 text-sm">
        <p className="font-medium">{finding.payload.kind === 'indicator' ? finding.payload.name : finding.indicatorSlug}: {dispositionLabel[decision.disposition]}</p>
        {decision.disposition === 'edit' && decision.correction ? <dl className="mt-2 space-y-2 text-xs">{Object.entries(decision.correction).map(([key, value]) => {
          const before = finding.payload.kind === 'indicator' ? (finding.payload as unknown as Record<string, unknown>)[key] : undefined;
          const unit = finding.payload.kind === 'indicator' ? finding.payload.unit : '';
          const show = (item: unknown, next: boolean) => key === 'value' && (typeof item === 'number' || typeof item === 'string' || item == null) ? formatIndicatorValue(item as number | string | null, next ? decision.correction?.unit ?? unit : unit) : item == null ? 'Not recorded' : String(item);
          return <div key={key}><dt className="font-medium">{key.replaceAll('_', ' ')}</dt><dd className="mt-1 break-words"><span>Current: {show(before, false)}</span><br /><span>Proposed: {show(value, true)}</span></dd></div>;
        })}</dl> : null}
        {decision.disposition === 'reject' ? <p className="mt-1 text-xs">The draft will retain an explicit data gap with the audit’s reason.</p> : null}
        {decision.disposition === 're_research' ? <p className="mt-1 text-xs">Prepare a new research plan with the audit notes. This does not start a research session.</p> : null}
      </li>)}</ul>
      <button type="button" disabled={pending || !expectedAuditIds.length} className="mt-3 min-h-11 rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => run(async () => { setResult(null); setResult(unwrap(await applyMachineAudits({ tenantSlug, runId, dimensionId, expectedAuditIds }))); })}>{pending ? 'Applying…' : 'Apply these recommendations'}</button>
    </details>
    {error ? <p role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}
    {result ? <p role="status" className="mt-2 text-sm">{result.versionNum ? `Draft version ${result.versionNum} created. ` : 'Recommendations applied. '}{result.runId ? <Link className="underline" href={`/${tenantSlug}/admin/research/${result.runId}`}>Inspect the new research plan</Link> : 'Review the draft before publishing.'}</p> : null}
  </section>;
}
