import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { valueAppearsInText } from '@deep-fryer/research';

/**
 * Readable text from a document's bytes, for the copy of a source that reviewers (and later checks)
 * read next to its snapshot.
 *
 * Returns the text, an empty string when the document is of a kind this reads but carries no readable
 * words (a scanned PDF, which is only pictures of pages, or a file too damaged to open), and null when
 * this does not read that kind of document at all (spreadsheets, images, anything else).
 *
 * PDFs are read with pdf.js (through unpdf, which carries its own build and no native code): only the
 * text layer, never a rendering, so no font program or script in the file runs. HTML and CSV are
 * decoded here without a library.
 */
export async function extractText(bytes: Uint8Array, contentType?: string): Promise<string | null> {
  const kind = documentKind(bytes, contentType);
  switch (kind) {
    case 'pdf':
      return pdfText(bytes);
    case 'html':
      return htmlToText(decode(bytes, contentType));
    case 'csv':
      return tidy(decode(bytes, contentType));
    default:
      return null;
  }
}

type DocumentKind = 'pdf' | 'html' | 'csv' | null;

/** The media type without parameters, lowercased: "Text/HTML; charset=UTF-8" reads as "text/html". */
function mediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

function documentKind(bytes: Uint8Array, contentType: string | undefined): DocumentKind {
  const type = mediaType(contentType);
  if (type === 'application/pdf' || type === 'application/x-pdf') return 'pdf';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'text/csv' || type === 'application/csv' || type === 'text/comma-separated-values') return 'csv';
  // Servers often label a PDF download as a generic binary; its own header says what it is.
  if ((type === '' || type === 'application/octet-stream') && looksLikePdf(bytes)) return 'pdf';
  return null;
}

/** A PDF file starts with "%PDF-" within its first kilobyte. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-');
}

/** Page breaks in extracted PDF text: a form feed, as pdftotext writes them, on a line of its own. */
export const PDF_PAGE_BREAK = '\n\f\n';

async function pdfText(bytes: Uint8Array): Promise<string> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // pdf.js takes ownership of the buffer it is given, so it gets a copy.
    document = await getDocumentProxy(new Uint8Array(bytes), {
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const { text } = await extractPdfText(document, { mergePages: false });
    const pages = text.map((page) => tidy(page));
    return pages.some((page) => page !== '') ? pages.join(PDF_PAGE_BREAK) : '';
  } catch {
    // A damaged or password-protected file has no text anyone can read.
    return '';
  } finally {
    // Ends the document and its parsing worker, as unpdf's own helpers do.
    await document?.loadingTask.destroy().catch(() => undefined);
  }
}

/** Decodes text bytes in the charset the content type names, UTF-8 otherwise, dropping a byte-order mark. */
function decode(bytes: Uint8Array, contentType: string | undefined): string {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

/** Line endings made "\n", trailing spaces dropped, runs of blank lines kept to one, ends trimmed. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Elements whose content a reader never sees as text. */
const HIDDEN_ELEMENTS = ['head', 'script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object'];

/** Elements that start a new line where they open and close. */
const BLOCK_ELEMENTS =
  'address|article|aside|blockquote|caption|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|' +
  'form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|tfoot|thead|tr|ul';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  minus: '−',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  percnt: '%',
  dollar: '$',
  cent: '¢',
  pound: '£',
  euro: '€',
  yen: '¥',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  para: '¶',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      // Out-of-range and surrogate code points are not characters; keep the reference as written.
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The words an HTML document shows, roughly as a browser's innerText would give them: hidden parts
 * dropped, a line per block, a tab between table cells, entities decoded, spacing collapsed.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const element of HIDDEN_ELEMENTS) {
    text = text.replace(new RegExp(`<${element}\\b[\\s\\S]*?</${element}\\s*>`, 'gi'), ' ');
  }
  // A tag is "<" then a letter, "/", "!" or "?", up to the next ">" with no other "<" inside. A "<"
  // followed by anything else ("a < b") is the text it reads as, and a broken tag is kept as text
  // rather than swallowing the figures after it.
  text = text
    // A tag cut off at the very end of the document (no ">" or "<" after it) is not text.
    .replace(/<[a-z!/?][^<>]*$/i, '')
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(new RegExp(`</?(?:${BLOCK_ELEMENTS})\\b[^<>]*>`, 'gi'), '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[a-z!/?][^<>]*>/gi, '');
  const lines = decodeEntities(text)
    .split(/\r\n?|\n/)
    .map((line) =>
      line
        .split('\t')
        .map((cell) => cell.replace(/[  \f\v]+/g, ' ').trim())
        .filter((cell) => cell !== '')
        .join('\t'),
    );
  return tidy(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Bounded page-window / keyword-matched excerpt extraction for oversized PDFs
// ---------------------------------------------------------------------------

/** Hard cap on UTF-8 bytes mounted in the read-only verifier workspace for an oversized PDF excerpt. */
export const DEFAULT_PDF_EXCERPT_MAX_BYTES = 64 * 1024;
/** Neighboring pages included on each side of a cited or matched page. */
export const DEFAULT_PDF_EXCERPT_WINDOW_RADIUS = 1;
/** Maximum number of distinct pages included in one bounded excerpt. */
export const DEFAULT_PDF_EXCERPT_MAX_PAGES = 12;
/** Header marking an excerpt so verifiers never mistake it for the full PDF. */
export const OVERSIZED_PDF_EXCERPT_HEADER = '[EXCERPT FROM OVERSIZED PDF — NOT THE FULL DOCUMENT]';

const PDF_SECTION_HEADING = 'Text of the PDF document';
const PDF_NO_TEXT_MARKER = 'This PDF has no readable text. It may be a scanned image.';

export interface PdfExcerptQuery {
  claimedValue?: string | number;
  indicatorName?: string;
  sourceUrl?: string;
  locatorText?: string;
  keywords?: readonly string[];
}

/** Header marking a bounded extracted text excerpt mounted beside or in place of a raw PDF. */
export const CAPTURED_TEXT_EXCERPT_HEADER = '[EXTRACTED TEXT EXCERPT FROM CAPTURED SOURCE]';

export interface PdfExcerptOptions {
  maxBytes?: number;
  windowRadius?: number;
  maxPages?: number;
  /** Override the default oversized-PDF header when mounting text for a normal or large PDF. */
  headerTitle?: string;
  /** Override the default reason sentence in the excerpt header. */
  headerReason?: string;
}

export type PdfExcerptMatchBasis = 'cited_page' | 'value_match' | 'keyword_match' | 'opening_pages';

export interface PdfExcerptResult {
  text: string;
  pagesIncluded: number[];
  totalPages: number;
  matchBasis: PdfExcerptMatchBasis[];
  truncated: boolean;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'under',
  'per', 'all', 'are', 'was', 'were', 'not', 'has', 'have', 'had', 'its', 'our',
  'their', 'total', 'rate', 'share', 'percent', 'annual', 'average', 'mean', 'median',
]);

/**
 * Pure: 1-indexed page numbers cited in a URL fragment (`#page=42`) or prose
 * locator (`p. 12`, `pp. 12-14`, `page 7`). Range spans are capped at 10 pages
 * so a malformed citation cannot explode page selection.
 */
export function parseCitedPageNumbers(sourceUrl?: string, locatorText?: string): number[] {
  const found = new Set<number>();
  if (sourceUrl) {
    try {
      const hash = new URL(sourceUrl).hash;
      const frag = /(?:^|[#&])page=(\d{1,5})\b/i.exec(hash);
      if (frag) {
        const n = Number.parseInt(frag[1]!, 10);
        if (n >= 1) found.add(n);
      }
    } catch {
      // Malformed URL: ignore fragment.
    }
  }
  if (locatorText) {
    const pattern = /\b(?:pp?\.|pages?)\s*(\d{1,5})(?:\s*[-–—]\s*(\d{1,5}))?/gi;
    for (const m of locatorText.matchAll(pattern)) {
      const start = Number.parseInt(m[1]!, 10);
      if (start < 1) continue;
      if (m[2]) {
        const end = Math.min(Number.parseInt(m[2], 10), start + 9);
        for (let p = start; p <= Math.max(start, end); p++) found.add(p);
      } else {
        found.add(start);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Pure: split a stored readable-text capture (`evidence/<hash>.txt`) into
 * 1-indexed PDF pages. Strips any leading HTML page section when
 * `Text of the PDF document` is present; returns `[]` when the PDF had no
 * readable text.
 */
export function extractPdfTextPages(storedText: string): string[] {
  const normalized = storedText.replace(/\r\n?/g, '\n');
  const headingPattern = new RegExp(`(?:^|\\n)${PDF_SECTION_HEADING}\\n\\n`);
  const match = headingPattern.exec(normalized);
  const body = (match ? normalized.slice(match.index + match[0].length) : normalized).trim();
  if (!body || body === PDF_NO_TEXT_MARKER) return [];
  const pages = body.split(PDF_PAGE_BREAK).map((page) => page.trim());
  return pages.some((p) => p !== '') ? pages : [];
}

function extractKeywords(query: PdfExcerptQuery): string[] {
  const raw = [query.indicatorName ?? '', ...(query.keywords ?? [])].join(' ');
  const tokens = raw.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return [...new Set(tokens.filter((t) => !STOP_WORDS.has(t)))];
}

function formatPageRanges(pages: readonly number[]): string {
  if (pages.length === 0) return 'none';
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = cur;
      prev = cur;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return ranges.join(', ');
}

/** Truncate UTF-8 text safely to at most `maxBytes` without splitting a multi-byte character. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  if (maxBytes <= 0) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

/**
 * Pure: extract a bounded, targeted text excerpt from an oversized PDF's pages
 * around cited page locators and value/keyword hits. Always prepends an
 * explicit oversized-PDF excerpt header and strictly enforces `maxBytes`.
 */
export function extractPageWindowExcerpt(
  pages: readonly string[],
  query: PdfExcerptQuery,
  options: PdfExcerptOptions = {},
): PdfExcerptResult {
  const totalPages = pages.length;
  if (totalPages === 0) {
    return { text: '', pagesIncluded: [], totalPages: 0, matchBasis: [], truncated: false };
  }

  const maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_PDF_EXCERPT_MAX_BYTES);
  const radius = Math.max(0, options.windowRadius ?? DEFAULT_PDF_EXCERPT_WINDOW_RADIUS);
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_PDF_EXCERPT_MAX_PAGES);

  const selected = new Set<number>();
  const basis = new Set<PdfExcerptMatchBasis>();

  const addWindow = (pageNum: number) => {
    const lo = Math.max(1, pageNum - radius);
    const hi = Math.min(totalPages, pageNum + radius);
    for (let p = lo; p <= hi; p++) {
      if (selected.size >= maxPages) break;
      selected.add(p);
    }
  };

  // 1. Explicit page locators from URL fragment (#page=N) or notes (p. N / pp. N-M).
  const cited = parseCitedPageNumbers(query.sourceUrl, query.locatorText).filter((p) => p <= totalPages);
  for (const p of cited) {
    if (selected.size >= maxPages) break;
    basis.add('cited_page');
    addWindow(p);
  }

  // 2. Score pages by claimed-value hit (strongest) and indicator/keyword overlap.
  const keywords = extractKeywords(query);
  const hasValue = query.claimedValue !== undefined && String(query.claimedValue).trim() !== '';
  const scored: { page: number; score: number; valueHit: boolean; keywordHit: boolean }[] = [];
  for (let i = 0; i < totalPages; i++) {
    const pageText = pages[i]!;
    if (!pageText) continue;
    const valueHit = hasValue ? valueAppearsInText(query.claimedValue!, pageText) : false;
    const lower = pageText.toLowerCase();
    let kwHits = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) kwHits += 1;
    }
    const score = (valueHit ? 100 : 0) + kwHits * 5;
    if (score > 0) scored.push({ page: i + 1, score, valueHit, keywordHit: kwHits > 0 });
  }
  scored.sort((a, b) => b.score - a.score || a.page - b.page);

  for (const hit of scored) {
    if (selected.size >= maxPages) break;
    if (hit.valueHit) basis.add('value_match');
    if (hit.keywordHit) basis.add('keyword_match');
    addWindow(hit.page);
  }

  // 3. Fallback: opening pages (title, contents, summary) when nothing matched.
  if (selected.size === 0) {
    basis.add('opening_pages');
    for (let p = 1; p <= Math.min(3, totalPages, maxPages); p++) selected.add(p);
  }

  const orderedPages = [...selected].sort((a, b) => a - b);
  const matchBasis = [...basis];

  const headerTitle = options.headerTitle ?? OVERSIZED_PDF_EXCERPT_HEADER;
  const headerReason = options.headerReason ?? 'Original PDF exceeded the 32 MiB direct archive limit';
  const makeHeader = (included: readonly number[]) =>
    `${headerTitle}\n` +
    `${headerReason}; showing bounded text excerpts ` +
    `(pages ${formatPageRanges(included)} of ${totalPages} total pages; matched by ${matchBasis.join(', ')}).\n` +
    `Verify carefully; pages outside this excerpt are not shown.\n\n`;

  const truncationSuffix = '\n[...excerpt truncated at byte limit...]';
  const reserveHeaderBytes = Buffer.byteLength(makeHeader(orderedPages), 'utf8') + 64;
  let bodyBudget = Math.max(256, maxBytes - reserveHeaderBytes);

  const chunks: string[] = [];
  const included: number[] = [];
  let truncated = false;

  for (const pageNum of orderedPages) {
    const sectionHeader = `--- Page ${pageNum} of ${totalPages} ---\n`;
    const fullSection = `${sectionHeader}${pages[pageNum - 1]!}\n\n`;
    const sectionBytes = Buffer.byteLength(fullSection, 'utf8');
    if (sectionBytes <= bodyBudget) {
      chunks.push(fullSection);
      included.push(pageNum);
      bodyBudget -= sectionBytes;
    } else {
      const suffixBytes = Buffer.byteLength(truncationSuffix, 'utf8');
      const available = bodyBudget - suffixBytes;
      if (available > Buffer.byteLength(sectionHeader, 'utf8') + 32) {
        chunks.push(truncateUtf8(fullSection, available) + truncationSuffix);
        included.push(pageNum);
      }
      truncated = true;
      break;
    }
  }

  const finalText = makeHeader(included) + chunks.join('').trimEnd() + '\n';
  const boundedText =
    Buffer.byteLength(finalText, 'utf8') <= maxBytes
      ? finalText
      : truncateUtf8(finalText, maxBytes - Buffer.byteLength(truncationSuffix, 'utf8')) + truncationSuffix;

  return {
    text: boundedText,
    pagesIncluded: included,
    totalPages,
    matchBasis,
    truncated: truncated || boundedText !== finalText,
  };
}

/**
 * Pure: format bounded readable text from a captured source (`evidence/<hash>.txt`)
 * for mounting as `archived-source-excerpt.txt`. Multi-page PDFs use
 * `extractPageWindowExcerpt`; single-page PDFs or captured HTML pages are
 * cleanly bounded to `maxBytes` (default 64 KiB) with an explicit header.
 */
export function buildArchivedTextExcerpt(
  storedText: string,
  query: PdfExcerptQuery,
  options: PdfExcerptOptions = {},
): PdfExcerptResult {
  const pages = extractPdfTextPages(storedText);
  if (pages.length > 1) {
    return extractPageWindowExcerpt(pages, query, options);
  }
  const trimmed = (pages[0] ?? storedText).trim();
  if (!trimmed) {
    return { text: '', pagesIncluded: [], totalPages: 0, matchBasis: [], truncated: false };
  }
  const maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_PDF_EXCERPT_MAX_BYTES);
  const headerTitle = options.headerTitle ?? CAPTURED_TEXT_EXCERPT_HEADER;
  const header = `${headerTitle}\nExtracted readable text from the captured source.\n\n`;
  const truncationSuffix = '\n[...excerpt truncated at byte limit...]';
  const full = `${header}${trimmed}\n`;
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) {
    return { text: full, pagesIncluded: [1], totalPages: 1, matchBasis: ['opening_pages'], truncated: false };
  }
  const available = Math.max(256, maxBytes - Buffer.byteLength(truncationSuffix, 'utf8'));
  return {
    text: truncateUtf8(full, available) + truncationSuffix,
    pagesIncluded: [1],
    totalPages: 1,
    matchBasis: ['opening_pages'],
    truncated: true,
  };
}

/**
 * Extract a bounded page-window / keyword-matched text excerpt directly from
 * raw PDF bytes via pdf.js (text layer only, never rendered). Returns null if
 * the PDF is damaged, password-protected, or carries no readable text.
 */
export async function extractPdfPageWindowFromBytes(
  bytes: Uint8Array,
  query: PdfExcerptQuery,
  options: PdfExcerptOptions = {},
): Promise<PdfExcerptResult | null> {
  const full = await pdfText(bytes);
  if (!full) return null;
  const pages = full.split(PDF_PAGE_BREAK).map((page) => page.trim());
  const result = extractPageWindowExcerpt(pages, query, options);
  return result.text ? result : null;
}
