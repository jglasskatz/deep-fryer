'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { framework } from '@deep-fryer/contract';
import {
  formatIndicatorValue,
  isFlagged,
  WHOLE_DIMENSION_GAP,
  type FindingPayload,
  type FindingVerification,
  type ReviewAudit,
} from '@deep-fryer/core';
import { approveFindings, flagGap, reResearchDimension } from '@/lib/review-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';
import { safeHref } from '@/lib/safe-url';
import { provenanceSentence, type FindingProvenance } from '@/app/[tenant]/admin/research/provenance';
import { AuditOpinions, AuditApplyPreview } from './ReviewAudits';

export interface ReviewFinding {
  id: string;
  indicatorSlug: string;
  payload: FindingPayload;
  verification: FindingVerification | null;
  audits: ReviewAudit[];
  /** Which provider and model produced it (for reviewers only; public pages never say). */
  provenance?: FindingProvenance;
}

/**
 * Shown on every finding salvaged from a session's malformed output
 * (FindingVerification.partial_output): the session may have returned more
 * findings than were recorded, so the dimension may be missing some. The
 * finding itself is flagged (core isFlagged) and judged like any other.
 */
const PARTIAL_OUTPUT_NOTE =
  'Partial output: the research session returned malformed JSON and only part of it could be read, so this dimension may be missing findings. Consider re-research.';

/**
 * Evidence captured with its readable text links to it; a capture that found no words to read says
 * so. Evidence captured before the text was kept has neither field and shows neither.
 */
const READABLE_TEXT_LINK = 'text research read';
const NO_READABLE_TEXT_NOTE =
  'No readable text: research could not read any words on this page or document. It may be a scanned image, so check the snapshot or PDF by eye.';

function PartialOutputNote() {
  return <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-900">{PARTIAL_OUTPUT_NOTE}</p>;
}

/** "Researched with … on Anthropic, shared server", and any model that answered after a refusal. */
function ProvenanceNote({ provenance }: { provenance: FindingProvenance | undefined }) {
  return <p className="mt-1 text-xs text-[color:var(--color-muted)]">{provenanceSentence(provenance)}</p>;
}

const frameworkNames = new Map(
  framework.dimensions.flatMap((d) => d.indicators.map((i) => [i.slug, i.name] as const)),
);

/**
 * What the gap form offers: each indicator the card's findings name, once,
 * in the card's order, by its name (a gap finding has none of its own, so
 * the framework's, else its key) — then, last, every indicator of the
 * dimension at once, for a dimension with no usable data at all. The value
 * is the indicator's key, which is what the gap records.
 */
export function gapChoices(findings: readonly Pick<ReviewFinding, 'indicatorSlug' | 'payload'>[]) {
  const choices = new Map<string, string>();
  for (const f of findings) {
    if (choices.has(f.indicatorSlug)) continue;
    const label = f.payload.kind === 'indicator' ? f.payload.name : frameworkNames.get(f.indicatorSlug) ?? f.indicatorSlug;
    choices.set(f.indicatorSlug, label);
  }
  return [
    ...[...choices].map(([value, label]) => ({ value, label })),
    { value: WHOLE_DIMENSION_GAP, label: 'Every indicator in this dimension (clears all its values)' },
  ];
}

/** What the reviewer is told once a gap is saved: it is a draft, and how it becomes public. */
export function gapSavedMessage(versionNum: number, requiresSecondReview: boolean): string {
  return requiresSecondReview
    ? `Gap saved as draft version ${versionNum}. Nothing is public yet: another editor needs to publish it.`
    : `Gap saved as draft version ${versionNum}. Nothing is public yet: publish it under "Publish reviewed drafts" at the top of this page.`;
}

/** The gap form as the reviewer sees it: what is chosen and typed, and how the last save went. */
export interface GapFormState {
  indicator: string;
  reason: string;
  /** True from the click until the server answers. */
  saving: boolean;
  /** Why the last save was refused, shown beside the form. */
  error: string;
  /** What the last successful save says (gapSavedMessage). */
  saved: string;
}

/** Shown when the save request gets no answer at all. */
export const NO_ANSWER = 'The server did not answer, so the gap may not have been saved. Reload the page to check, then try again.';

export const emptyGapForm: GapFormState = { indicator: '', reason: '', saving: false, error: '', saved: '' };

/**
 * Send the form's chosen indicator and reason, and return the form as it
 * should look afterwards: emptied with the saved message on success, or as
 * it was with the reason for the refusal, so nothing typed is lost.
 */
export async function submitGap(
  send: typeof flagGap,
  where: { tenantSlug: string; dimensionId: string },
  form: GapFormState,
): Promise<GapFormState> {
  try {
    const result = await send({ ...where, indicator: form.indicator, reason: form.reason });
    if (result.ok) {
      return { ...emptyGapForm, saved: gapSavedMessage(result.data.versionNum, result.data.requiresSecondReview) };
    }
    return { ...form, saving: false, error: result.error };
  } catch {
    // The request itself failed (no connection, or the server went away), so
    // whether the draft was written is unknown.
    return { ...form, saving: false, error: NO_ANSWER };
  }
}

/**
 * The gap form's fields and button. It holds no state of its own: the card
 * passes the form in and is told of each change and of the click.
 */
export function GapForm({
  choices,
  form,
  busy,
  onChange,
  onSave,
}: {
  choices: { value: string; label: string }[];
  form: GapFormState;
  /** Another action on the card is running. */
  busy: boolean;
  onChange: (patch: Partial<GapFormState>) => void;
  onSave: () => void;
}) {
  const locked = busy || form.saving;
  return (
    <div className="mt-2 w-full max-w-80 space-y-2">
      <label className="block">
        <span className="font-medium">Indicator with no usable data</span>
        <select
          className="mt-1 min-h-11 w-full min-w-0 rounded border border-field-border bg-[color:var(--color-bg)] px-2"
          value={form.indicator}
          disabled={locked}
          onChange={(e) => onChange({ indicator: e.target.value })}
        >
          <option value="">Choose an indicator</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-medium">Reason</span>
        <textarea
          className="mt-1 w-full rounded border border-field-border px-2 py-1"
          rows={2}
          placeholder="Why no acceptable data exists. The public sees this once the draft is published."
          value={form.reason}
          disabled={locked}
          onChange={(e) => onChange({ reason: e.target.value })}
        />
      </label>
      {form.error ? (
        <p role="alert" className="text-red-700">
          {form.error}
        </p>
      ) : null}
      <button
        type="button"
        className="min-h-11 rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
        disabled={locked || !form.indicator || !form.reason.trim()}
        onClick={onSave}
      >
        {form.saving ? 'Saving…' : 'Save gap as draft'}
      </button>
    </div>
  );
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
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [gap, setGap] = useState<GapFormState>(emptyGapForm);
  const [includeNarrative, setIncludeNarrative] = useState(false);
  const narrativeFindings = findings.filter(finding => finding.payload.kind === 'indicator' && finding.payload.narrative_draft);
  const narrativeSupported = narrativeFindings.length > 0 && narrativeFindings.every(finding => finding.verification?.narrative_supported === 'pass');
  const { run: act, pending, error } = useAction();

  // Gap cards always warrant review attention; sourced findings use the
  // shared red-flag predicate (SPEC.md §8: flagged, never dropped).
  const flagged = findings.filter(
    (f) => f.payload.kind === 'gap' || (f.verification && isFlagged(f.verification)),
  ).length;

  return (
    // The id is the draft doughnut's link target (admin/draft: a wedge or row
    // opens its dimension's card, `?run=<run>#review-<dimension id>`); the
    // scroll margin keeps the card's heading clear of the sticky header.
    <div id={`review-${dimensionId}`} className="scroll-mt-24 rounded-lg border border-black/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {dimensionName}
          <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">{ring}</span>
        </h3>
        <div className="flex items-center gap-2 text-xs">
          {approvedVersionNum ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-green-900">
              approved → v{approvedVersionNum}
            </span>
          ) : flagged > 0 ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-red-900">{flagged} flagged</span>
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
          <div key={f.id}><FindingRow finding={f} evidenceBase={evidenceBase} /><AuditOpinions audits={f.audits} /><NarrativeProposal finding={f} evidenceBase={evidenceBase} /></div>
        ))}
      </div>

      {narrativeFindings.length > 0 ? <div className="mt-4 rounded border border-black/15 p-3 text-sm">
        <label className="flex min-h-11 items-start gap-2"><input className="mt-1" type="checkbox" checked={includeNarrative} disabled={pending || (!narrativeSupported && !includeNarrative)} onChange={event => setIncludeNarrative(event.target.checked)} /><span>Include the proposed context and actions when approving this card</span></label>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">Unchecked preserves the current narrative. {narrativeSupported ? 'Check the proposals and their sources before replacing it.' : 'The proposal cannot be included until independent narrative verification passes.'}</p>
      </div> : null}

      <AuditApplyPreview tenantSlug={tenantSlug} runId={runId} dimensionId={dimensionId} findings={findings} />

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-black/10 pt-3">
        <button
          className="min-h-11 rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => act(() => approveFindings({ tenantSlug, runId, dimensionId, includeNarrative }))}
        >
          Approve as draft
        </button>
        <button
          className="min-h-11 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => act(() => approveFindings({ tenantSlug, runId, dimensionId, publish: true, includeNarrative }))}
        >
          Approve &amp; publish
        </button>
        <Link
          className="inline-flex min-h-11 items-center rounded border px-3 py-1.5 text-xs hover:bg-black/5"
          href={`/${tenantSlug}/admin/dim/${dimensionId}`}
        >
          Edit
        </Link>

        <details className="text-xs">
          <summary className="min-h-11 cursor-pointer rounded border px-3 py-3 hover:bg-black/5">
            Re-research…
          </summary>
          <div className="mt-2 w-full max-w-80">
            <textarea
              className="w-full rounded border border-field-border px-2 py-1"
              rows={3}
              aria-label="Reviewer notes for re-research"
              placeholder="Reviewer notes — injected verbatim into the new session"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              className="mt-1 min-h-11 rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
              disabled={pending || !notes.trim()}
              onClick={() =>
                act(async () => {
                  const { runId: newRun } = unwrap(
                    await reResearchDimension({
                      tenantSlug,
                      dimensionId,
                      notes,
                    }),
                  );
                  router.push(`/${tenantSlug}/admin/research/${newRun}`);
                })
              }
            >
              Plan re-research
            </button>
          </div>
        </details>

        <details className="text-xs">
          <summary className="min-h-11 cursor-pointer rounded border px-3 py-3 hover:bg-black/5">
            Flag gap…
          </summary>
          <GapForm
            choices={gapChoices(findings)}
            form={gap}
            busy={pending}
            onChange={(patch) => setGap((current) => ({ ...current, ...patch, error: '' }))}
            onSave={() => {
              const sending = { ...gap, saving: true, error: '', saved: '' };
              setGap(sending);
              act(async () => setGap(await submitGap(flagGap, { tenantSlug, dimensionId }, sending)));
            }}
          />
        </details>
      </div>
      <p role="status" className="mt-2 text-sm">{gap.saved}</p>
    </div>
  );
}

export function FindingRow({ finding, evidenceBase }: { finding: ReviewFinding; evidenceBase: string }) {
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
        <ProvenanceNote provenance={finding.provenance} />
        {v?.partial_output ? <PartialOutputNote /> : null}
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
              <Badge ok={v.recency_ok} label="recency" />
              <Badge ok={v.scale_ok} label="scale" />
              <Badge
                ok={v.content_supported === 'pass'}
                label={`source ${v.content_supported}`}
                title={v.verifier_note}
              />
              {v.partial_output ? <Badge ok={false} label="partial output" title={PARTIAL_OUTPUT_NOTE} /> : null}
            </>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-lg font-semibold">
        {formatIndicatorValue(payload.value, payload.unit)}
        <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">
          ({payload.year}) · target {formatIndicatorValue(payload.target, payload.unit)} · level {formatIndicatorValue(payload.level_pct, '%')}
        </span>
      </p>
      <p className="mt-1 break-words font-mono text-[11px] text-[color:var(--color-muted)]">
        {payload.scoring.worked_math}
      </p>
      <p className="mt-1 text-xs">
        {safeHref(payload.source_url) ? (
          <a className="underline" href={safeHref(payload.source_url)} target="_blank" rel="noreferrer">
            {payload.source}
          </a>
        ) : (
          <span title="Source URL is not http(s) and is not linked">
            {payload.source} <span className="text-red-700">(unlinkable URL)</span>
          </span>
        )}
      </p>
      <ProvenanceNote provenance={finding.provenance} />
      {v?.verifier_note && v.content_supported !== 'pass' ? (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-900">
          Verifier: {v.verifier_note}
        </p>
      ) : null}
      {v?.partial_output ? <PartialOutputNote /> : null}
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
            {payload.evidence.text_path ? (
              <>
                {' · '}
                <a
                  className="underline"
                  href={`${evidenceBase}/${payload.evidence.text_path}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {READABLE_TEXT_LINK}
                </a>
              </>
            ) : null}
          </p>
          {!payload.evidence.text_path && payload.evidence.no_readable_text ? (
            <p className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">{NO_READABLE_TEXT_NOTE}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NarrativeProposal({ finding, evidenceBase }: { finding: ReviewFinding; evidenceBase: string }) {
  const proposal = finding.payload.kind === 'indicator' ? finding.payload.narrative_draft : null;
  if (!proposal) return null;
  const verdict = finding.verification?.narrative_supported ?? 'uncertain';
  return <details className="mt-2 rounded border border-black/15 p-3">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Proposed context and actions · narrative verification: {verdict}</summary>
    <p className="mt-3 whitespace-pre-wrap text-sm">{proposal.context}</p>
    <ul className="mt-3 space-y-4">{proposal.actions.map((action, index) => <li key={index} className="text-sm">
      <p>{action.text}</p>
      <p className="mt-1 flex flex-wrap gap-3 text-xs">{safeHref(action.source_url) ? <a className="underline" href={safeHref(action.source_url)} rel="noopener noreferrer">Original source ↗</a> : null}<a className="underline" href={`${evidenceBase}/${action.evidence.snapshot_path}`}>Archived evidence</a>{action.evidence.pdf_path ? <a className="underline" href={`${evidenceBase}/${action.evidence.pdf_path}`}>Archived PDF</a> : null}{action.evidence.text_path ? <a className="underline" href={`${evidenceBase}/${action.evidence.text_path}`}>{READABLE_TEXT_LINK}</a> : action.evidence.no_readable_text ? <span>{NO_READABLE_TEXT_NOTE}</span> : null}</p>
      <a href={`${evidenceBase}/${action.evidence.snapshot_path}`}><img loading="lazy" className="mt-2 max-h-48 w-full rounded border border-black/10 object-contain object-left" src={`${evidenceBase}/${action.evidence.snapshot_path}`} alt={`Archived source for: ${action.text}`} /></a>
    </li>)}</ul>
  </details>;
}
