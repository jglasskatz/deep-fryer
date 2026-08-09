'use client';

import { useState } from 'react';
import { approveRun } from '@/lib/verify-actions';
import { useAction } from '@/lib/use-action';

export type ApprovalPanelState = 'blocked' | 'ready' | 'stale' | 'current';

/**
 * The hash-bound confirmation stage (approval-binds-to-content), in the web.
 * Approving here writes the same audit record as
 * `research-verify --approve` — the CLI and this panel see each other's
 * approvals, and any change to the findings strands both as stale.
 */
export function ApprovalPanel({
  tenantSlug,
  runId,
  state,
  blockerCount,
  hash,
  approvedBy,
  approvedAt,
  approverLabel,
  sampleCount,
  sampleVerified,
}: {
  tenantSlug: string;
  runId: string;
  state: ApprovalPanelState;
  blockerCount: number;
  hash: string;
  approvedBy?: string;
  approvedAt?: string;
  approverLabel: string;
  sampleCount: number;
  sampleVerified: number;
}) {
  const { run: act, pending, error } = useAction();
  const [inspected, setInspected] = useState(false);

  if (state === 'current') {
    return (
      <section className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
        <p className="font-medium">✓ Run approved</p>
        <p className="mt-1 text-xs">
          by {approvedBy}
          {approvedAt ? ` · ${approvedAt.slice(0, 16).replace('T', ' ')}` : ''} · content hash{' '}
          <span className="font-mono">{hash.slice(0, 16)}…</span> — any change to the findings
          voids this approval.
        </p>
      </section>
    );
  }

  if (state === 'blocked') {
    return (
      <section className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-medium">✗ Approval blocked</p>
        <p className="mt-1 text-xs">
          {blockerCount} critical violation{blockerCount === 1 ? '' : 's'} open — every flagged
          finding needs an individual disposition and the spot-check sample must be verified
          (review-disposes-each-flag). Work the list above; this panel unlocks when the gate is
          clean.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border p-3 text-sm ${
        state === 'stale' ? 'border-red-300 bg-red-50' : 'border-black/15'
      }`}
    >
      {state === 'stale' ? (
        <p className="font-medium text-red-900">
          Approval is stale — findings changed since {approvedBy ?? 'the last approval'} recorded
          it (approval-binds-to-content). Re-review and re-approve.
        </p>
      ) : (
        <p className="font-medium">Review complete — confirmation required</p>
      )}
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        Approving binds your name to content hash <span className="font-mono">{hash.slice(0, 16)}…</span>{' '}
        ({sampleVerified}/{sampleCount} spot-check findings inspected). Signature meaning:
        &ldquo;verified&rdquo;.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={inspected}
          onChange={(e) => setInspected(e.target.checked)}
        />
        I inspected the spot-check sample and the flagged findings myself.
      </label>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      <button
        className="mt-2 rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        disabled={pending || !inspected}
        onClick={() => act(() => approveRun({ tenantSlug, runId }))}
      >
        Approve run as {approverLabel}
      </button>
    </section>
  );
}
