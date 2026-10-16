'use client';

import { useState } from 'react';
import { INVOLVEMENT_LIMITS, type InvolvementListingInput } from '@deep-fryer/core';
import { reopenSubmission, reviewSubmission } from '@/lib/involvement-admin-actions';
import { useAction } from '@/lib/use-action';
import { ListingForm } from './ListingForm';

/**
 * The decision controls on one submission card (SPEC-v6 §4.3).
 *
 * A new submission offers three decisions, each opening inline under the
 * card so staff keep the organization's words in view while they decide:
 *
 * - Approve… opens the listing form prefilled from the submission (the
 *   server computed the draft); saving creates the listing and marks the
 *   submission approved in one transaction.
 * - Decline… and Mark spam… ask for an optional note for other staff. The
 *   submitter is never told — the public form sends no email (SPEC-v6 §4.2).
 *
 * A declined or spam submission offers only "Move back to New", for the
 * reviewer who pressed the wrong button. An approved one offers nothing
 * here: its listing (in the Listings section) is where it is changed.
 */

type Decision = 'approve' | 'declined' | 'spam';

const DECISION_COPY = {
  declined: { open: 'Decline…', confirm: 'Decline', pending: 'Declining…' },
  spam: { open: 'Mark spam…', confirm: 'Mark as spam', pending: 'Marking…' },
} as const;

export function SubmissionActions({
  tenantSlug,
  submissionId,
  status,
  draft,
}: {
  tenantSlug: string;
  submissionId: string;
  status: 'new' | 'approved' | 'declined' | 'spam';
  /** The listing form's starting values (listingDraftFromSubmission). */
  draft: InvolvementListingInput;
}) {
  const [open, setOpen] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const review = useAction();
  const reopen = useAction();
  const panelId = `submission-${submissionId}-decision`;

  if (status === 'approved') return null;

  if (status === 'declined' || status === 'spam') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={reopen.pending}
          className="rounded border px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
          onClick={() => reopen.run(() => reopenSubmission({ tenantSlug, submissionId }))}
        >
          {reopen.pending ? 'Moving…' : 'Move back to New'}
        </button>
        {reopen.error ? (
          <span role="alert" className="text-xs text-red-700">
            {reopen.error}
          </span>
        ) : null}
      </div>
    );
  }

  const toggle = (decision: Decision) => {
    setOpen(open === decision ? null : decision);
    setNote('');
    review.setError(null);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open === 'approve'}
          aria-controls={panelId}
          className="rounded bg-black px-2.5 py-1 text-xs font-medium text-white"
          onClick={() => toggle('approve')}
        >
          Approve…
        </button>
        {(['declined', 'spam'] as const).map((decision) => (
          <button
            key={decision}
            type="button"
            aria-expanded={open === decision}
            aria-controls={panelId}
            className={
              decision === 'spam'
                ? 'rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50'
                : 'rounded border px-2 py-1 text-xs hover:bg-black/5'
            }
            onClick={() => toggle(decision)}
          >
            {DECISION_COPY[decision].open}
          </button>
        ))}
      </div>

      <div id={panelId}>
        {open === 'approve' ? (
          <div className="mt-3 rounded border border-black/15 p-3">
            <p className="mb-3 text-sm">
              Edit the submission into a listing. Nothing is public until the listing is published; contact details are
              not copied.
            </p>
            <ListingForm
              tenantSlug={tenantSlug}
              approve={{ submissionId, draft }}
              onCancel={() => setOpen(null)}
            />
          </div>
        ) : open === 'declined' || open === 'spam' ? (
          <form
            className="mt-3 space-y-2 rounded border border-black/15 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const decision = open;
              review.run(() => reviewSubmission({ tenantSlug, submissionId, status: decision, note }));
            }}
          >
            <label className="block text-sm">
              <span className="font-medium">Note for staff</span>{' '}
              <span className="text-xs text-[color:var(--color-muted)]">(optional, never sent to the submitter)</span>
              <textarea
                className="mt-1 w-full rounded border border-black/20 bg-white px-2 py-1 text-sm"
                rows={2}
                maxLength={INVOLVEMENT_LIMITS.reviewNote}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={open === 'spam' ? 'e.g. advertising, unrelated to the city' : 'e.g. not active in the city'}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={review.pending}
                className={
                  open === 'spam'
                    ? 'rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'
                    : 'rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'
                }
              >
                {review.pending ? DECISION_COPY[open].pending : DECISION_COPY[open].confirm}
              </button>
              <button
                type="button"
                disabled={review.pending}
                className="text-sm underline disabled:opacity-50"
                onClick={() => setOpen(null)}
              >
                Cancel
              </button>
              {review.error ? (
                <span role="alert" className="text-xs text-red-700">
                  {review.error}
                </span>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
