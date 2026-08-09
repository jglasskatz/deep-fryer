'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isFlagged, type FindingPayload, type FindingVerification } from '@deep-fryer/core';
import { approveFindings, flagGap, reResearchDimension } from '@/lib/review-actions';
import { useAction } from '@/lib/use-action';

export interface ReviewFinding {
  id: string;
  indicatorSlug: string;
  payload: FindingPayload;
  verification: FindingVerification | null;
}

function Badge({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        ok ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
      }`}
    >
      {label}
    </span>
  );
}

export interface CardDispositions {
  verified: number;
  rejected: number;
  needsRework: number;
  openFlags: number;
}

export function ReviewCard({
  tenantSlug,
  runId,
  dimensionId,
  dimensionName,
  ring,
  findings,
  approvedVersionNum,
  sessionId,
  canReadTranscript,
  evidenceBase,
  dispositions,
}: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  dimensionName: string;
  ring: string;
  findings: ReviewFinding[];
  approvedVersionNum: number | null;
  sessionId: string | null;
  canReadTranscript: boolean;
  evidenceBase: string;
  dispositions: CardDispositions;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [gapReason, setGapReason] = useState('');
  const { run: act, pending, error } = useAction();

  // Gap cards always warrant review attention; sourced findings use the
  // shared red-flag predicate (SPEC.md §8: flagged, never dropped).
  const flagged = findings.filter(
    (f) => f.payload.kind === 'gap' || (f.verification && isFlagged(f.verification)),
  ).length;
  // Approval is blocked while flagged findings lack individual dispositions
  // or sit in needs_rework (review-disposes-each-flag) — the server enforces
  // this too; the UI just says so up front.
  const approveBlocked = dispositions.openFlags > 0 || dispositions.needsRework > 0;
  const blockedTitle = approveBlocked
    ? `${dispositions.openFlags} open flag(s), ${dispositions.needsRework} needs-rework — disposition each in Verify first`
    : undefined;

  return (
    <div className="rounded-lg border border-black/15 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          {dimensionName}
          <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">{ring}</span>
        </h3>
        <div className="flex items-center gap-2 text-xs">
          {dispositions.verified + dispositions.rejected + dispositions.needsRework > 0 ? (
            <span className="rounded bg-black/10 px-2 py-0.5">
              {dispositions.verified} verified · {dispositions.rejected} rejected
              {dispositions.needsRework ? ` · ${dispositions.needsRework} rework` : ''}
            </span>
          ) : null}
          {approvedVersionNum ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-green-900">
              approved → v{approvedVersionNum}
            </span>
          ) : dispositions.openFlags > 0 ? (
            <Link
              className="rounded bg-red-100 px-2 py-0.5 text-red-900 underline"
              href={`/${tenantSlug}/admin/verify/${runId}`}
              title="Disposition each in the verify view"
            >
              {dispositions.openFlags} open flag{dispositions.openFlags === 1 ? '' : 's'}
            </Link>
          ) : flagged > 0 ? (
            <span className="rounded bg-black/10 px-2 py-0.5">{flagged} flagged · dispositioned</span>
          ) : null}
          {canReadTranscript && sessionId ? (
            <a
              className="underline"
              href={`/api/research/sessions/${sessionId}/transcript`}
              target="_blank"
            >
              transcript
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {findings.map((f) => (
          <FindingRow key={f.id} finding={f} evidenceBase={evidenceBase} />
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-black/10 pt-3">
        <button
          className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending || approveBlocked}
          title={blockedTitle}
          onClick={() => act(() => approveFindings({ tenantSlug, runId, dimensionId }))}
        >
          Approve as draft
        </button>
        <button
          className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending || approveBlocked}
          title={blockedTitle}
          onClick={() => act(() => approveFindings({ tenantSlug, runId, dimensionId, publish: true }))}
        >
          Approve &amp; publish
        </button>
        <Link
          className="rounded border px-3 py-1.5 text-xs hover:bg-black/5"
          href={`/${tenantSlug}/admin/dim/${dimensionId}`}
        >
          Edit
        </Link>

        <details className="text-xs">
          <summary className="cursor-pointer rounded border px-3 py-1.5 hover:bg-black/5">
            Re-research…
          </summary>
          <div className="mt-2 w-80">
            <textarea
              className="w-full rounded border border-black/20 px-2 py-1"
              rows={3}
              placeholder="Reviewer notes — injected verbatim into the new session"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              className="mt-1 rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
              disabled={pending || !notes.trim()}
              onClick={() =>
                act(async () => {
                  const { runId: newRun } = await reResearchDimension({
                    tenantSlug,
                    dimensionId,
                    notes,
                    fromRunId: runId,
                  });
                  router.push(`/${tenantSlug}/admin/research/${newRun}`);
                })
              }
            >
              Plan re-research
            </button>
          </div>
        </details>

        <details className="text-xs">
          <summary className="cursor-pointer rounded border px-3 py-1.5 hover:bg-black/5">
            Flag gap…
          </summary>
          <div className="mt-2 w-80">
            <textarea
              className="w-full rounded border border-black/20 px-2 py-1"
              rows={2}
              placeholder="Why no acceptable data exists — published on the gray wedge"
              value={gapReason}
              onChange={(e) => setGapReason(e.target.value)}
            />
            <button
              className="mt-1 rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
              disabled={pending || !gapReason.trim()}
              onClick={() =>
                act(() =>
                  flagGap({
                    tenantSlug,
                    dimensionId,
                    indicator: findings[0]?.indicatorSlug ?? 'all',
                    reason: gapReason,
                  }),
                )
              }
            >
              Publish honest gap wedge
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

function FindingRow({ finding, evidenceBase }: { finding: ReviewFinding; evidenceBase: string }) {
  const { payload, verification: v } = finding;

  if (payload.kind === 'gap') {
    return (
      <div className="rounded border border-dashed border-black/25 bg-black/[0.02] p-3 text-sm">
        <p className="font-medium">
          Data gap — {payload.indicator_slug}
          <span className="ml-2 rounded bg-black/10 px-1.5 py-0.5 text-[11px]">gap card</span>
        </p>
        <p className="mt-1">{payload.reason}</p>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          Scales tried: {payload.scales_tried.join(', ')}
          {payload.tiers_tried?.length ? ` · tiers ${payload.tiers_tried.join(', ')}` : ''}
          {payload.nearest_data ? ` · nearest: ${payload.nearest_data}` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/15 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{payload.name}</p>
        <div className="flex flex-wrap gap-1">
          <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">
            tier {payload.source_tier}
          </span>
          <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">
            {payload.geographic_scale}
          </span>
          <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">
            {payload.confidence} confidence
          </span>
          {v ? (
            <>
              <Badge ok={v.url_ok} label="url" />
              <Badge ok={v.schema_ok} label="schema" />
              <Badge ok={v.recency_ok} label="recency" />
              <Badge ok={v.scale_ok} label="scale" />
              <Badge
                ok={v.content_supported === 'pass'}
                label={`source ${v.content_supported}`}
                title={v.verifier_note}
              />
            </>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-lg font-semibold">
        {payload.value} <span className="text-xs font-normal">{payload.unit}</span>
        <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">
          ({payload.year}) · target {payload.target} · level {payload.level_pct}%
        </span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-[color:var(--color-muted)]">
        {payload.scoring.worked_math}
      </p>
      <p className="mt-1 text-xs">
        <a className="underline" href={payload.source_url} target="_blank" rel="noreferrer">
          {payload.source}
        </a>
      </p>
      {v?.verifier_note && v.content_supported !== 'pass' ? (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-900">
          Verifier: {v.verifier_note}
        </p>
      ) : null}
      {payload.notes ? (
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">Session notes: {payload.notes}</p>
      ) : null}
      {payload.evidence ? (
        <div className="mt-2">
          <a
            href={`${evidenceBase}/${payload.evidence.snapshot_path}`}
            target="_blank"
            rel="noreferrer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${evidenceBase}/${payload.evidence.snapshot_path}`}
              alt={`Evidence snapshot for ${payload.name}`}
              className="max-h-40 rounded border border-black/15"
            />
          </a>
          <p className="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
            captured {payload.evidence.captured_at.slice(0, 10)}
            {payload.evidence.pdf_path ? (
              <>
                {' · '}
                <a
                  className="underline"
                  href={`${evidenceBase}/${payload.evidence.pdf_path}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  source PDF
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
