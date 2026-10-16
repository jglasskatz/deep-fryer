'use client';

import { useRouter } from 'next/navigation';
import { buildDoughnut } from '@/lib/research-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

/**
 * The "Build my doughnut" button (SPEC-v7 §4): one click plans and starts
 * the full research run (lib/research-actions.ts buildDoughnut), then opens
 * the run page, which shows progress. The page around it has already shown
 * the estimate and who pays; `blockedReason` (the gate's own message, from
 * the same decision function) disables the button when the click would be
 * refused anyway. The server decides again at click time.
 */
export function BuildDoughnut({ tenantSlug, blockedReason }: { tenantSlug: string; blockedReason: string | null }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || blockedReason !== null}
        className="rounded bg-[color:var(--color-accent)] px-5 py-2.5 text-base font-semibold text-white disabled:opacity-50"
        onClick={() =>
          run(
            async () => {
              const { runId } = unwrap(await buildDoughnut({ tenantSlug }));
              router.push(`/${tenantSlug}/admin/research/${runId}`);
            },
            { refresh: false },
          )
        }
      >
        {pending ? 'Starting the research…' : 'Build my doughnut'}
      </button>
      {blockedReason ? (
        <p className="text-sm text-red-800">{blockedReason}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
