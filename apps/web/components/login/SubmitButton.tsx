'use client';

import { useFormStatus } from 'react-dom';

/**
 * A sign-in form's submit button that shows the request is under way
 * (SPEC-v6 §2.2). Sending a magic link or starting an OAuth redirect takes
 * the server several seconds; without feedback people press again, which
 * sends another link (three outstanding links per address is the limit, see
 * auth.ts) or looks broken.
 *
 * While the form's action is pending the button is disabled (no second
 * submission), shows a spinner, and swaps its label for `pendingLabel` when
 * one is given ("Sending…"). OAuth buttons keep their provider name — the
 * browser leaves for the provider next, and "Sending…" would not describe
 * that. A polite live region repeats the pending label for screen readers,
 * since a changed button label is not announced on its own. Works inside a
 * server-rendered <form action={serverAction}>: useFormStatus reads the
 * nearest parent form.
 */
export function SubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending || undefined}
        className={`inline-flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70 ${className ?? ''}`}
      >
        {pending ? (
          <svg
            aria-hidden
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : null}
        <span>{pending && pendingLabel ? pendingLabel : label}</span>
      </button>
      <span role="status" className="sr-only">
        {pending && pendingLabel ? pendingLabel : ''}
      </span>
    </>
  );
}
