'use client';

import { useId, useRef, useState } from 'react';
import { approveUnflaggedFindings } from '@/lib/review-actions';
import { applyMachineApproved } from '@/lib/machine-audit-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One finding of the spot-check sample, shaped on the server (admin/draft/page.tsx). */
export interface SpotCheckItem {
  id: string;
  /** "Housing — Rent burden". */
  label: string;
  /** "42 % (2024)". */
  value: string;
  source: string;
  /** The source's own address when it is a safe http(s) link (lib/safe-url.ts), else null. */
  sourceHref: string | null;
  /** The finding's review card. */
  reviewHref: string;
}

/**
 * "Approve all unflagged" (staff, editor and up) for one settled run with no
 * flags left open. The button first asks, in words, exactly how many
 * findings in how many dimensions it will approve — as drafts, nothing
 * published — and shows a random sample of them to check against their
 * sources (the review principle: people measure what the checks pass by
 * looking at some of it). Approving is enabled once the person says they
 * checked the sample; the action then approves no more than the stated
 * count and only with that sample (lib/review-actions.ts
 * approveUnflaggedFindings).
 *
 * The confirmation is part of the page, not window.confirm: it has links and
 * a checkbox, and keyboard and screen-reader users meet it where the button
 * was (focus moves to it, and back when it is cancelled). The action
 * revalidates this page, whose response carries the new render
 * (lib/use-action.ts `refresh: false`); the outcome is announced in a polite
 * live region that stays mounted across that render. After an approval the
 * focused "Approve" button goes with the confirmation, and the button that
 * opened it goes too once nothing is left to approve, so focus moves to that
 * live region (focusable for the purpose) rather than falling to the top of
 * a long page (WCAG 2.4.3).
 */
export function ApproveUnflagged({
  tenantSlug,
  runId,
  findings,
  dimensions,
  sample,
  mode = 'unflagged',
}: {
  tenantSlug: string;
  runId: string;
  /** Findings it would approve, and the dimensions they belong to (one draft version each). */
  findings: number;
  dimensions: number;
  /** The findings to spot-check first (lib/draft-portrait.ts spotCheckSample). */
  sample: SpotCheckItem[];
  mode?: 'unflagged' | 'machine';
}) {
  const { run, pending, error } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLButtonElement | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  const titleId = useId();
  const checkId = useId();

  const approve = () =>
    run(
      async () => {
        const result = unwrap<{ findings: number; versions: unknown[] }>(
          await (mode === 'machine' ? applyMachineApproved : approveUnflaggedFindings)({
            tenantSlug,
            runId,
            expectedFindings: findings,
            spotChecked: sample.map((s) => s.id),
          }),
        );
        setConfirming(false);
        setChecked(false);
        setOutcome(
          result.versions.length === 0
            ? 'Nothing was approved: since this page loaded, these dimensions were approved or reviewed by someone else.'
            : `Approved ${plural(result.findings, 'finding')} into ${plural(result.versions.length, 'draft version')}. Nothing is published yet.`,
        );
        // The button that had focus is gone with the confirmation: keep the person where the outcome is.
        requestAnimationFrame(() => outcomeRef.current?.focus());
      },
      { refresh: false },
    );

  return (
    <div>
      <p ref={outcomeRef} tabIndex={-1} role="status" className="text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]">
        {outcome}
      </p>
      {findings === 0 ? null : confirming ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={titleId}
          className="mt-2 max-w-2xl rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
        >
          <p id={titleId} className="font-semibold">
            Approve {plural(findings, 'finding')} in {plural(dimensions, 'dimension')} as drafts?
          </p>
          <p className="mt-1">
            Each dimension gets a draft version from this run&apos;s findings, as &ldquo;Approve as draft&rdquo;
            does on its card. Nothing is published: each draft still needs publishing.
          </p>
          <p className="mt-3">
            First check {sample.length === 1 ? 'this finding' : `these ${sample.length} findings`}, picked at
            random from the ones being approved, against {sample.length === 1 ? 'its source' : 'their sources'}:
          </p>
          <ol className="mt-1 list-decimal space-y-1 ps-5">
            {sample.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.label}</span>: {s.value} ·{' '}
                {s.sourceHref ? (
                  <a className="underline" href={s.sourceHref} target="_blank" rel="noreferrer">
                    {s.source}
                  </a>
                ) : (
                  s.source
                )}{' '}
                ·{' '}
                <a className="underline" href={s.reviewHref}>
                  review card
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-start gap-2">
            <input
              id={checkId}
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <label htmlFor={checkId}>
              I checked {sample.length === 1 ? 'this finding' : `these ${sample.length} findings`} against{' '}
              {sample.length === 1 ? 'its source' : 'their sources'}.
            </label>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              disabled={pending || !checked}
              onClick={approve}
            >
              {pending ? 'Approving…' : `Approve ${plural(findings, 'finding')}`}
            </button>
            <button
              type="button"
              className="min-h-11 rounded border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setChecked(false);
                // The button that opened the question comes back; focus returns to it.
                requestAnimationFrame(() => openRef.current?.focus());
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={openRef}
          type="button"
          className="mt-2 min-h-11 rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => {
            setOutcome(null);
            setConfirming(true);
            requestAnimationFrame(() => confirmRef.current?.focus());
          }}
        >
          {mode === 'machine' ? 'Apply machine-approved findings' : 'Approve all unflagged'} ({plural(findings, 'finding')})
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 max-w-xl text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
