import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

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
