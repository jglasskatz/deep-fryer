'use client';

/** Root-layout failures (the layout itself threw): minimal, dependency-free page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1.5rem', maxWidth: 560, margin: '0 auto' }}>
        <h1>Something went wrong</h1>
        <p>
          The application failed to load.{error.digest ? ` Reference: ${error.digest}.` : ''}
        </p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
