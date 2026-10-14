import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-20 sm:px-6">
      <p aria-hidden className="text-4xl">
        🍩
      </p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-[color:var(--color-muted)]">
        There is no portrait or page at this address. It may have moved, or the portrait may not
        be published yet.
      </p>
      <p className="mt-6">
        <Link className="underline" href="/">
          Go home
        </Link>
      </p>
    </main>
  );
}
