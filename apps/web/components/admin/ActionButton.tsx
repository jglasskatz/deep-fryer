'use client';

import type { ActionResult } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

/**
 * A button bound to one server action, with pending state and the action's
 * error message rendered beside it. Server components pass a bound action
 * (`publishVersion.bind(null, {...})`), so no client code re-implements the
 * call. `refresh={false}` for an action that revalidates the page the button
 * is on, whose response already carries that page (lib/use-action.ts).
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  className,
  confirm,
  refresh = true,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Optional confirmation prompt before running. */
  confirm?: string;
  /** Refresh the page after success (the default); see useAction. */
  refresh?: boolean;
}) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={className ?? 'rounded border px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50'}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run(action, { refresh });
        }}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {error ? (
        <span role="alert" className="max-w-md text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
