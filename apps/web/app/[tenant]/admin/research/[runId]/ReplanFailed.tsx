'use client';

import { useRouter } from 'next/navigation';
import { planResearchAction } from '@/lib/research-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

/**
 * "Plan a new run for the failed dimensions": plans (never applies) a run of
 * just the dimensions whose sessions failed or never ran, and opens it, so
 * staff inspect it and apply it — the quota-checked step — from its own run
 * page, exactly as for a run planned on the research page. Planning is free.
 */
export function ReplanFailed({
  tenantSlug,
  dimensionIds,
}: {
  tenantSlug: string;
  dimensionIds: string[];
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const n = dimensionIds.length;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className="rounded border px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
        onClick={() =>
          run(async () => {
            const { runId } = unwrap(await planResearchAction({ tenantSlug, dimensionIds }));
            router.push(`/${tenantSlug}/admin/research/${runId}`);
          })
        }
      >
        {pending ? 'Planning…' : `Plan a new run for the ${n} dimension${n === 1 ? '' : 's'} that didn’t complete`}
      </button>
      {error ? (
        <span role="alert" className="max-w-md text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
