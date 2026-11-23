'use client';

import { useRouter } from 'next/navigation';
import { buildDoughnut } from '@/lib/research-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

/**
 * The "Build my doughnut" button (SPEC-v7 §4): one click plans and starts
 * the full research run (lib/research-actions.ts buildDoughnut), then opens
 * the run page, which shows progress. The page around it has already shown
 * the estimate and who pays, and shows the button only when the research
 * gate's preview would let the click through; while it would not, the page
 * says how building becomes available instead of showing a button that
 * cannot be pressed. The server decides again at click time, and its
 * refusal, if any, is shown here.
 */
export function BuildDoughnut({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
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
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
