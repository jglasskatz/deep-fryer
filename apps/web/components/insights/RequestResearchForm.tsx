'use client';

import { useState } from 'react';
import { useAction } from '@/lib/use-action';
import { requestResearch } from '@/lib/insight-actions';
import { unwrap } from '@/lib/action-result';

/**
 * Editor affordance on the insights page (gated by the tenant's
 * features.request_research flag): plan + enqueue a single-dimension
 * research run with a note injected into the session prompt.
 */
export function RequestResearchForm({
  tenantSlug,
  tenantName,
  dimensionSlug,
}: {
  tenantSlug: string;
  tenantName: string;
  dimensionSlug: string;
}) {
  const { run, pending, error } = useAction();
  const [note, setNote] = useState('');
  const [requested, setRequested] = useState<string | null>(null);

  if (requested) {
    return (
      <p className="text-xs text-green-700">
        Research run enqueued for {tenantName} ({requested.slice(0, 8)}) — findings will land in
        the review queue.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={`Note for the researcher (optional) — what should the ${tenantName} session look for or fix?`}
        rows={2}
        className="w-full rounded border border-black/15 p-2 text-xs"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() =>
            run(async () => {
              const res = unwrap(await requestResearch({ tenantSlug, dimensionSlug, note }));
              setRequested(res.runId);
            })
          }
          disabled={pending}
          className="rounded bg-[color:var(--color-accent)] px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? 'Enqueuing…' : 'Request research'}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
