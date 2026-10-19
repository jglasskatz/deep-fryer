'use client';

import { useEffect } from 'react';
import { useSupportEmail } from '@/components/site-footer/SupportEmail';

/**
 * Last-resort error boundary for every route. Shows the digest so a city
 * staffer can quote it to support, and the support address to quote it to
 * (SUPPORT_EMAIL, provided by the root layout — this boundary renders inside
 * it, footer included); never shows internals.
 *
 * Its words are English only, but it renders inside the root layout's
 * <html lang dir> of whatever page failed — /es/… or /ar/… — so it says
 * which language and direction it is in (WCAG 3.1.2), as LegalPage does:
 * read with Spanish or Arabic rules, or laid out right to left, the English
 * would be garbled and its full stop on the wrong end.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const support = useSupportEmail();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" lang="en" dir="ltr" className="mx-auto max-w-lg px-4 py-20 sm:px-6">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-[color:var(--color-muted)]">
        The page could not be loaded. Try again; if it keeps happening, contact support
        {support ? (
          <>
            {' '}
            at{' '}
            <a className="underline [overflow-wrap:anywhere]" href={`mailto:${support}`}>
              {support}
            </a>
          </>
        ) : null}
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
