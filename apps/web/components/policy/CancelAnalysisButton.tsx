'use client';

import { cancelPolicyAnalysis } from '@/lib/policy-actions';
import { useAction } from '@/lib/use-action';

/**
 * Cancel a queued analysis (lib/policy-actions.ts cancelPolicyAnalysis):
 * the way to release its reserved research session when the worker is not
 * picking it up. No confirmation step — a cancelled analysis costs nothing
 * and its page offers to run the same brief again. If the worker claims the
 * analysis first, the action refuses and says so, and the status poll
 * (AnalysisStatus) re-renders the page as "Running" within seconds.
 */
export function CancelAnalysisButton({ tenantSlug, id }: { tenantSlug: string; id: string }) {
  const { run, pending, error } = useAction();
  return (
    <div className="mt-2">
      <button
        type="button"
        className="rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50"
        disabled={pending}
        onClick={() => run(() => cancelPolicyAnalysis({ tenantSlug, id }))}
      >
        {pending ? 'Cancelling…' : 'Cancel this analysis'}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
