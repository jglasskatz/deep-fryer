/**
 * Text utilities for the source knowledge base (SPEC.md §8). The normalizer
 * is shared by the worker's quote check, the web's highlight/excerpt
 * rendering, and the backfill script — it must stay byte-identical across
 * all of them, which is why it lives in core.
 */

/** Extracted source text is truncated here before hashing/storing/indexing. */
export const SOURCE_TEXT_MAX_CHARS = 500_000;

/** Quotes shorter than this (normalized) are too weak to attest anything. */
export const QUOTE_MIN_CHARS = 12;

/**
 * NFKC, curly→straight quotes, dashes→hyphen, NBSP→space, collapse
 * whitespace, lowercase — so a passage copied from a rendered page matches
 * the same passage in extracted text despite typography differences.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Does the source text contain the quoted passage (normalized containment)? */
export function quoteSupported(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < QUOTE_MIN_CHARS) return false;
  return normalizeForMatch(sourceText).includes(q);
}

export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

/**
 * A window of ±context original characters around the first normalized match
 * of `quote` in `text`. Mapping normalized offsets back to the original is
 * done by scanning the original with the same character classes the
 * normalizer collapses, so the returned slices are verbatim source text.
 */
export function excerptAround(text: string, quote: string, context = 500): Excerpt | null {
  const normQuote = normalizeForMatch(quote);
  if (normQuote.length < QUOTE_MIN_CHARS) return null;

  // Build the normalized string alongside a map from normalized index →
  // original index, applying the same transforms as normalizeForMatch.
  const map: number[] = [];
  let norm = '';
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!.normalize('NFKC');
    if (/[‘’‚‛]/.test(ch)) ch = "'";
    else if (/[“”„‟]/.test(ch)) ch = '"';
    else if (/[‐-―−]/.test(ch)) ch = '-';
    else if (ch === ' ') ch = ' ';
    if (/\s/.test(ch)) {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      map.push(i);
      norm += ' ';
      pendingSpace = false;
    }
    for (const c of ch.toLowerCase()) {
      map.push(i);
      norm += c;
    }
  }

  const at = norm.indexOf(normQuote);
  if (at < 0) return null;
  const startOrig = map[at]!;
  const endOrig = map[Math.min(at + normQuote.length - 1, map.length - 1)]! + 1;
  return {
    before: text.slice(Math.max(0, startOrig - context), startOrig),
    match: text.slice(startOrig, endOrig),
    after: text.slice(endOrig, Math.min(text.length, endOrig + context)),
  };
}

/**
 * Crude, dependency-free HTML→text for the backfill script (captures use the
 * real browser's innerText instead): drop non-content elements, strip tags,
 * decode the common entities.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|head|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
