'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from './action-result';

function isFailedResult(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ActionResult<unknown>).ok === false &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

/**
 * The app's one client-side convention for calling server actions:
 * run → refresh on success → surface the error message on failure.
 *
 * Server actions return ActionResult values (lib/action-result.ts). `fn` may
 * return one directly (`run(() => voteComment(...))`) — a failed result is
 * displayed and the refresh skipped — or unwrap() inside to use the data and
 * let a failure throw.
 *
 * Each hook instance has its own pending state, so independent forms on one
 * page (SettingsForms) never disable each other.
 */
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>, opts: { refresh?: boolean } = {}) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (isFailedResult(result)) {
          setError(result.error);
          return;
        }
        if (opts.refresh !== false) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return { run, pending, error, setError };
}
