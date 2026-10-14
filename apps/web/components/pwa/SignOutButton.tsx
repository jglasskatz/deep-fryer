'use client';

/**
 * Sign-out that also tells the service worker to drop saved pages. Signed-in
 * pages are never cached (x-df-cache), so this is belt and braces for a
 * shared municipal computer.
 */
export function SignOutButton({ action, className }: { action: () => Promise<void>; className?: string }) {
  return (
    <form
      action={action}
      onSubmit={() => navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PAGES' })}
    >
      <button className={className}>Sign out</button>
    </form>
  );
}
