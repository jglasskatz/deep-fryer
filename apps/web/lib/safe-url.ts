/**
 * Research output and human edits put URLs on the page (source_url,
 * supporting_source_url). A finding could carry `javascript:` — the v2
 * review found exactly that vector in ReviewCard (SPEC-v3 §2.3). Every
 * rendered source link goes through safeHref, which only lets http(s)
 * through; anything else renders as plain text.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

/** A stand-in origin to resolve paths against; `.invalid` can never be a real host. */
const SAME_SITE_BASE = 'https://same-site.invalid';

/**
 * A path on this site that is safe to send someone to after sign-in, or null
 * — the one rule behind lib/auth.ts safeNextPath and the sign-in pages'
 * `next` (app/login/sign-in.ts).
 *
 * Prefix checks are not enough. Browsers resolve a redirect's Location with
 * the WHATWG URL parser, which drops tabs and newlines anywhere and treats
 * `\` as `/` in http(s) URLs, so `/\t/evil.example` — which starts with one
 * slash and passes a "not `//`" test — lands on https://evil.example. Next
 * copies a redirect's target into the Location header as is, and Node lets a
 * tab through. So the path is resolved here exactly as a browser would,
 * against a stand-in origin: anything that leaves that origin is refused, and
 * what is returned is the parsed path, query, and fragment, re-serialized —
 * with no tab, newline, or backslash left in it to be read differently by
 * whatever consumes it next.
 */
export function sameSitePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(path, SAME_SITE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== SAME_SITE_BASE) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
