'use client';

import { openBillingPortal } from '@/lib/billing-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

export function PortalButton({ orgSlug }: { orgSlug: string }) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className="rounded border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
        onClick={() =>
          run(
            async () => {
              const { url } = unwrap(await openBillingPortal({ orgSlug }));
              window.location.assign(url);
            },
            { refresh: false },
          )
        }
      >
        {pending ? 'Opening…' : 'Manage billing (payment methods, invoices, plan)'}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
