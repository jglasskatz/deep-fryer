'use client';

import { useState } from 'react';
import type { ReviewNote } from '@deep-fryer/db';
import { addReviewNote } from '@/lib/verify-actions';
import { useAction } from '@/lib/use-action';

/**
 * Run-scoped reviewer commentary: impressions, follow-ups, working notes —
 * readable by every reviewer, attached to nothing in particular.
 */
export function RunNotes({
  tenantSlug,
  runId,
  notes,
}: {
  tenantSlug: string;
  runId: string;
  notes: ReviewNote[];
}) {
  const { run: act, pending, error } = useAction();
  const [note, setNote] = useState('');
  return (
    <section className="rounded-lg border border-black/15 p-3">
      <h2 className="text-sm font-semibold">Reviewer notes</h2>
      {notes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {notes.map((n) => (
            <li key={n.id} className="rounded border border-black/10 p-2">
              <p className="text-[11px] text-[color:var(--color-muted)]">
                {n.reviewerLabel} ·{' '}
                {new Date(n.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
              </p>
              {n.note ? <p className="mt-0.5">{n.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          Nothing yet — jot impressions, follow-ups, anything other reviewers should see.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded border border-black/20 px-2 py-1 text-xs"
          placeholder="Add a run-level note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="rounded border px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
          disabled={pending || !note.trim()}
          onClick={() =>
            act(async () => {
              await addReviewNote({ tenantSlug, runId, note });
              setNote('');
            })
          }
        >
          Add
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </section>
  );
}
