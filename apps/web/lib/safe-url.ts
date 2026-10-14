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
