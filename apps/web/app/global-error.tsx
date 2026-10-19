'use client';

/**
 * The page shown when the root layout itself fails — the one error page
 * that replaces the layout, so it has no header, footer, stylesheet, font or
 * support address (those all come from the layout). It is therefore
 * self-contained: its own <html>, a few inline styles in the site's colours
 * for light and dark devices, the system font, no script beyond Next's own
 * and nothing fetched from anywhere. The reference (digest) is what support
 * needs to find the server-side log entry; the message never shows internals.
 *
 * Colours are the theme tokens' values (app/globals.css), written out
 * because the stylesheet that defines them is the layout's.
 */
const STYLES = `
  :root { color-scheme: light dark; }
  body { margin: 0; background: #fafaf7; color: #1a1a1a; font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 34rem; margin: 0 auto; padding: 5rem 1.5rem; }
  h1 { font-size: 1.5rem; margin: 1rem 0 0.5rem; }
  p { color: #4b5563; margin: 0.5rem 0; }
  code { background: #ecece6; border-radius: 4px; padding: 0 0.3em; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.5rem; }
  button, a.home { font: inherit; font-size: 0.875rem; border-radius: 6px; padding: 0.5rem 1rem; cursor: pointer; text-decoration: none; }
  button { background: #2f7d32; color: #fafaf7; border: 0; font-weight: 600; }
  a.home { color: inherit; border: 1px solid #767676; }
  button:focus-visible, a.home:focus-visible { outline: 2px solid #2f7d32; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #121411; color: #efeee9; }
    p { color: #a8aba3; }
    code { background: #23261f; }
    button { background: #7cc47f; color: #121411; }
    a.home { border-color: #8a8d86; }
    button:focus-visible, a.home:focus-visible { outline-color: #7cc47f; }
  }
`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · deep-fryer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <style>{STYLES}</style>
      </head>
      <body>
        <main id="main">
          <p aria-hidden style={{ fontSize: '2.25rem', margin: 0 }}>
            🍩
          </p>
          <h1>Something went wrong</h1>
          <p>
            The site could not load this page. Try again in a moment; if it keeps happening, tell whoever runs
            this site{error.digest ? (
              <>
                {' '}
                and mention reference <code>{error.digest}</code>
              </>
            ) : null}
            .
          </p>
          <div className="actions">
            <button type="button" onClick={reset}>
              Try again
            </button>
            {/* A full page load, not client navigation: the layout that failed is not to be reused. */}
            <a className="home" href="/">
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
