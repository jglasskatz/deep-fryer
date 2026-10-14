'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary for every route. Shows the digest so a city
 * staffer can quote it to support; never shows internals.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-20 sm:px-6">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-[color:var(--color-muted)]">
        The page could not be loaded. Try again; if it keeps happening, contact support
        {error.digest ? (
          <>
            {' '}
            and mention reference <code className="rounded bg-black/5 px-1">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div className="mt-6 flex gap-3">
        <button onClick={reset} className="rounded bg-black px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
        <a href="/" className="rounded border border-black/20 px-4 py-2 text-sm">
          Home
        </a>
      </div>
    </main>
  );
}
