import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page, type Response as PageResponse } from 'playwright-core';
import { assertPublicHttpsUrl, guardedFetch } from '@deep-fryer/research';
import type { TenantStorage } from './storage.js';
import { extractText } from './text-extract.js';

export interface CaptureResult {
  snapshot_path: string;
  pdf_path?: string;
  /** The readable text of the page (and its PDF), when there was any. */
  text_path?: string;
  /** Set when the page and its PDF carried no readable words (a scanned document, an image). */
  no_readable_text?: true;
  captured_at: string;
}

/** Maximum PDF download size accepted during capture to prevent worker OOM (64 MiB). */
export const MAX_PDF_DOWNLOAD_BYTES = 64 * 1024 * 1024;
/** Maximum time allowed for downloading a source PDF during evidence capture. */
export const PDF_DOWNLOAD_TIMEOUT_MS = 30_000;
/** Default bounded preview length returned by `capture_evidence` MCP tool. */
export const DEFAULT_CAPTURE_PREVIEW_CHARS = 2_000;
/** Maximum concurrent Playwright browser contexts allowed in one worker process to cap RAM. */
export const MAX_BROWSER_CONTEXTS = 6;

/**
 * Bounded FIFO semaphore limiting concurrent Chromium contexts across
 * `read_source` and `capture_evidence` calls so parallel dimension sessions
 * cannot OOM worker RAM.
 */
export class BrowserContextSemaphore {
  readonly maxConcurrency: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrency = MAX_BROWSER_CONTEXTS) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new RangeError(`maxConcurrency must be a positive integer, got ${maxConcurrency}`);
    }
    this.maxConcurrency = maxConcurrency;
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const defaultBrowserSemaphore = new BrowserContextSemaphore(MAX_BROWSER_CONTEXTS);

/**
 * Stream-read a fetch Response body with a strict byte cap so an oversized
 * remote PDF cannot OOM or stall the worker process.
 */
export async function readResponseBytesCapped(
  res: Pick<Response, 'headers' | 'body' | 'arrayBuffer'>,
  maxBytes = MAX_PDF_DOWNLOAD_BYTES,
): Promise<Buffer> {
  const declaredLength = res.headers?.get?.('content-length');
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      await res.body?.cancel?.().catch(() => {});
      throw new Error(`PDF download exceeds ${maxBytes} bytes (content-length ${parsed})`);
    }
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`PDF download exceeds ${maxBytes} bytes`);
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`PDF download exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Pure: build a bounded preview (~2,000 chars) of captured readable text for
 * `capture_evidence` tool results: opening context plus high-signal lines with
 * numbers/tables when the full document exceeds `maxChars`.
 */
export function buildCapturePreview(
  text: string | null | undefined,
  maxChars = DEFAULT_CAPTURE_PREVIEW_CHARS,
): { text_char_count: number; text_preview: string } {
  if (!text) return { text_char_count: 0, text_preview: '' };
  const charCount = text.length;
  if (charCount <= maxChars) {
    return { text_char_count: charCount, text_preview: text };
  }
  const openingBudget = Math.floor(maxChars * 0.6);
  const opening = text.slice(0, openingBudget).trimEnd();
  const rest = text.slice(openingBudget);
  const separator = '\n\n[...table/numeric lines...]\n';
  let remaining = maxChars - opening.length - separator.length;
  if (remaining <= 80) {
    return { text_char_count: charCount, text_preview: text.slice(0, maxChars) };
  }
  const signalLines: string[] = [];
  for (const rawLine of rest.split('\n')) {
    const line = rawLine.trim();
    if (!line || !/\d/.test(line)) continue;
    const addition = (signalLines.length ? '\n' : '') + line;
    if (addition.length > remaining) {
      if (signalLines.length === 0 && remaining > 20) {
        signalLines.push(line.slice(0, remaining));
      }
      break;
    }
    signalLines.push(line);
    remaining -= addition.length;
  }
  if (signalLines.length === 0) {
    return { text_char_count: charCount, text_preview: text.slice(0, maxChars) };
  }
  return {
    text_char_count: charCount,
    text_preview: `${opening}${separator}${signalLines.join('\n')}`.slice(0, maxChars),
  };
}

// One browser per worker process; each capture gets an isolated context.
// Launching Chromium per capture would cost seconds on every source a run
// touches. closeEvidenceBrowser() runs at the end of each research run.
let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // The worker image runs as a non-root user (Dockerfile), so Chromium's
    // own sandbox stays on.
  });
  return browserPromise;
}

export async function closeEvidenceBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

/**
 * Deterministic exhibit gate (docs/haiku-5-5.md §3.5, exhibit-validity-check stage 1).
 *
 * The browser always reaches *something*, and until this gate whatever it reached was archived: a
 * Cloudflare challenge, an "Access Denied" page, a sign-in wall, a blank shell whose scripts never
 * ran. That snapshot then sits beside the claim in the review queue and the public drilldown as if
 * it were the source, and the finding looks evidenced when it is not. The checks below need no
 * model and look only at what the page itself reports — its HTTP status, its title, how much text
 * it shows, whether it is a sign-in form — so they are cheap, repeatable, and testable without a
 * browser (classifyExhibit is pure; readExhibitSignals is the only part that touches the page).
 *
 * The bar is "certainly not the document", not "probably fine": a false refusal costs the
 * researcher a good source (often the tier-1 one), while a miss only leaves today's behavior in
 * place for staff to catch. So every pattern is anchored to the wording block and error pages
 * actually use, and the tests carry real data-page titles that must pass.
 */
export type ExhibitProblemCode = 'http_status' | 'block_title' | 'near_empty' | 'password_field';

export interface ExhibitProblem {
  code: ExhibitProblemCode;
  /** One clause, written for the researcher who reads the tool result. */
  detail: string;
}

/** What the gate reads off a loaded page, as plain data. */
export interface ExhibitSignals {
  /** HTTP status of the document the browser ended on; undefined when Playwright reported no response. */
  status?: number;
  /** That response's content-type header, when it had one. */
  contentType?: string;
  /** document.title. */
  title: string;
  /** The body's innerText: what a person looking at the snapshot could read. */
  visibleText: string;
  /**
   * Password inputs a person would see in the page's content. Hidden login widgets in a closed menu do
   * not count, and neither do inputs in the page's chrome (PAGE_CHROME: header, nav, aside, footer and
   * their ARIA landmark roles), where a site puts its site-wide login box beside every document.
   */
  passwordFields: number;
}

/**
 * Fewer visible characters than this (whitespace collapsed) means the page did not render a
 * document. A data page carries at least its heading, navigation and a sentence or table around the
 * value, which is well past 100; what falls under it is the blank shell left when scripts were
 * blocked, a bare "Loading…", or an interstitial whose content sits in an iframe (Imperva/Incapsula
 * serve exactly that). Kept low on purpose: a sparse dashboard page must not be refused.
 */
export const MIN_EXHIBIT_TEXT_CHARS = 100;

/**
 * A password field marks a sign-in wall only on a page that shows fewer visible characters than this
 * (whitespace collapsed). A sign-in wall's text is its form (labels, "Forgot password?", a line of help)
 * plus the site's header and footer, which stays under this even on a portal with a full menu. A
 * document page can carry a login box too: older CMS themes put a "User login" block in a sidebar that
 * is a plain <div>, so PAGE_CHROME cannot see it, and some portals keep a staff or permit login on every
 * page. Such a page also shows the document's own text, which takes it past this, and then the password
 * field is the site's furniture, not the page. So the field alone never refuses a page.
 *
 * What this lets through: a sign-in wall wrapped in more site text than this, and a "sign in to keep
 * reading" overlay on a document whose text sits behind it. Both are archived, as every page was before
 * the gate, which is the side the bar ("certainly not the document") chooses.
 */
export const MAX_SIGN_IN_PAGE_TEXT_CHARS = 1_500;

/** HTTP reason phrases as error pages print them ("Forbidden", "404 - File or directory not found."). */
const REASON_PHRASE =
  '(?:bad request|unauthori[sz]ed|forbidden|not found|file or directory not found|too many requests|' +
  'internal server error|bad gateway|service (?:temporarily )?unavailable|gateway time-?out)';

/**
 * Titles that only block, challenge, and error pages carry. Patterns that could match a real
 * source's title are anchored (start of title, whole title, or a vendor's fixed suffix); the few
 * left unanchored ("captcha", "human verification", bot checks) name nothing but a challenge. Looser
 * matching refuses real sources: a bare /^5\d\d/
 * would refuse CDC's "500 Cities: Local Data for Better Health", /^\d{3}\b/ NYC's "311 Service
 * Requests", and an unanchored "access denied" an advocacy report of that name.
 */
const BLOCK_TITLE_PATTERNS: RegExp[] = [
  // Cloudflare: the JS/managed challenge, its block page, and the firewall-rule (1020) page.
  /^just a moment\b/i,
  /\|\s*cloudflare$/i,
  /used cloudflare to restrict access/i,
  // reCAPTCHA, hCaptcha, and every home-grown captcha wall say so in the title.
  /captcha/i,
  // Akamai, AWS WAF, Sucuri and most CDNs: "Access Denied", alone or after the vendor's name.
  /^access denied[.!]?$/i,
  /[-–|:]\s*access denied[.!]?$/i,
  // PerimeterX/HUMAN, Imperva/Distil, Incapsula, F5 BIG-IP ASM, DDoS-Guard, generic proxies.
  /^access to this page has been denied/i,
  /^pardon our interruption/i,
  /^request (?:rejected|unsuccessful)\b/i,
  /^the requested url was rejected/i,
  /^ddos-guard\b/i,
  /^web ?(?:site|page) blocked\b/i,
  /\byou have been blocked\b/i,
  /^checking (?:your browser|if the site connection is secure)\b/i,
  // "Are you a robot?" and its relatives.
  /\b(?:are you a robot|are you (?:a )?human|robot or human|robot check|bot (?:check|verification|detection))\b/i,
  /\b(?:verify(?:ing)?|confirm) (?:that )?you(?:'re| are) (?:a )?human\b/i,
  /\bhuman verification\b/i,
  /^security check\b/i,
  // Error pages served in place of the document: a 4xx/5xx code followed by its reason phrase or
  // "Error" ("403 Forbidden", "404 Error"), "Error 503", a reason phrase that is the whole title, or a
  // soft 404 that answered 200. A code alone is not enough (see "500 Cities" above).
  new RegExp(`^(?:error:?\\s*)?[45]\\d\\d\\s*[-–:|.]?\\s*(?:error\\b|${REASON_PHRASE})`, 'i'),
  /^error:?\s*[45]\d\d\b/i,
  new RegExp(`^${REASON_PHRASE}[.!]?$`, 'i'),
  /\bpage (?:not found|cannot be found|could not be found|does not exist)\b/i,
];

/**
 * Pure: every reason the loaded page must not be archived as evidence; an empty list means archive
 * it. All four checks run, so the tool result names everything wrong at once.
 */
export function classifyExhibit(signals: ExhibitSignals): ExhibitProblem[] {
  const problems: ExhibitProblem[] = [];
  if (signals.status !== undefined && signals.status >= 400) {
    problems.push({ code: 'http_status', detail: `the server answered HTTP ${signals.status}` });
  }
  const title = signals.title.replace(/\s+/g, ' ').trim();
  if (title && BLOCK_TITLE_PATTERNS.some((p) => p.test(title))) {
    // The title is page-controlled text going back into the model's context: quote it as data and
    // keep it short. It matched a block pattern, so it is a short stock title anyway.
    problems.push({
      code: 'block_title',
      detail: `the page title ${JSON.stringify(title.slice(0, 80))} is a block, challenge, or error page`,
    });
  }
  // Only an HTML document is expected to carry its content as text. A source served as an image, a
  // PDF in a viewer, CSV or JSON renders differently, and its snapshot still shows the content.
  const html = !signals.contentType || /html/i.test(signals.contentType);
  const textLength = signals.visibleText.replace(/\s+/g, ' ').trim().length;
  if (html && textLength < MIN_EXHIBIT_TEXT_CHARS) {
    problems.push({
      code: 'near_empty',
      detail: `the page shows only ${textLength} characters of text (a blank, loading, or blocked page)`,
    });
  }
  if (signals.passwordFields > 0 && textLength < MAX_SIGN_IN_PAGE_TEXT_CHARS) {
    problems.push({
      code: 'password_field',
      detail: `the page is a sign-in form (a password field and only ${textLength} characters of text), not a document`,
    });
  }
  return problems;
}

/**
 * Thrown when the gate refuses a page. capture_evidence's handler (session.ts) reports any thrown
 * error to the researcher as {"error": "capture failed: <message>"}, so the message is written for
 * the researcher: what was wrong, and what to do instead. No snapshot is stored for a refused page.
 */
export class ExhibitRefusedError extends Error {
  readonly problems: ExhibitProblem[];

  constructor(problems: ExhibitProblem[]) {
    super(
      `not archived as evidence: ${problems.map((p) => p.detail).join('; ')}. The browser did not reach the ` +
        'source document, so a snapshot would not show the value. Retry capture_evidence once if the block ' +
        'may be temporary; otherwise choose another source for this value.',
    );
    this.name = 'ExhibitRefusedError';
    this.problems = problems;
  }
}

/**
 * The page's chrome: the elements and ARIA landmarks a site repeats around every page. A login box in
 * one of these (a header login, a sidebar "User login" block in an <aside>) belongs to the site, not to
 * the page, so readExhibitSignals does not count it. A sign-in wall puts its form in the content.
 */
const PAGE_CHROME =
  'header, nav, aside, footer, [role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"]';

/** The gate's view of a loaded page (see ExhibitSignals). */
async function readExhibitSignals(page: Page, response: PageResponse | null): Promise<ExhibitSignals> {
  const [title, visibleText, passwordFields] = await Promise.all([
    page.title(),
    // A document with no <body> (an XML or SVG response) reads as empty, which only counts against
    // it when it claimed to be HTML.
    page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''),
    // Visible password inputs with no chrome ancestor. Matching `type` is case-insensitive in HTML, so
    // type="PASSWORD" counts too.
    page.locator(`input[type="password"]:not(:is(${PAGE_CHROME}) *)`).filter({ visible: true }).count(),
  ]);
  return {
    status: response?.status(),
    contentType: response?.headers()['content-type'],
    title,
    visibleText,
    passwordFields,
  };
}

/** Heads each part of a text copy that holds both the page's text and its PDF's. */
export const PAGE_TEXT_HEADING = 'Text of the captured page';
export const PDF_TEXT_HEADING = 'Text of the PDF document';
/** Written in place of a PDF's text when it had none. */
export const PDF_WITHOUT_TEXT_NOTE = 'This PDF has no readable text. It may be a scanned image.';

/**
 * Pure: the text copy stored beside a capture, or null when there is nothing readable to store.
 * `pdfText` is undefined when no PDF was archived, and '' when one was but had no text layer.
 *
 * A page alone is stored as its text. When a PDF was archived too, both parts are kept under plain
 * headings, so a reviewer knows which part they are reading, and a PDF without text says so. The
 * headings carry no digits, so a later search of the copy for a claimed number cannot match them.
 */
export function composeReadableText(pageText: string, pdfText?: string): string | null {
  const page = pageText.trim();
  const pdf = pdfText?.trim();
  if (pdf === undefined) return page === '' ? null : `${page}\n`;
  if (page === '' && pdf === '') return null;
  const parts: string[] = [];
  if (page !== '') parts.push(`${PAGE_TEXT_HEADING}\n\n${page}`);
  parts.push(`${PDF_TEXT_HEADING}\n\n${pdf === '' ? PDF_WITHOUT_TEXT_NOTE : pdf}`);
  return `${parts.join('\n\n')}\n`;
}

export interface RenderedSourceDocument {
  url: string;
  finalUrl: string;
  contentType: string;
  status?: number;
  capturedAt: string;
  pngBytes: Buffer;
  pdfBytes?: Buffer;
  readableText: string | null;
  noReadableText?: true;
  pdfUrl?: string;
}

/**
 * Render a public HTTPS source page in an isolated Playwright context (bounded
 * by `semaphore`), pass the exhibit gate, optionally download and extract text
 * from an associated or direct PDF via pinned-IP `guardedFetch`, and return the
 * raw bytes + composed readable text without writing to storage yet.
 */
export async function renderSourceDocument(
  url: string,
  pdfUrl?: string,
  opts: { semaphore?: BrowserContextSemaphore } = {},
): Promise<RenderedSourceDocument> {
  await assertPublicHttpsUrl(url);
  const capturedAt = new Date().toISOString();
  const semaphore = opts.semaphore ?? defaultBrowserSemaphore;

  let pngBytes: Buffer;
  let pageText: string;
  let finalUrl = url;
  let contentType = 'text/html';
  let status: number | undefined;

  await semaphore.run(async () => {
    const context = await (await browser()).newContext({
      viewport: { width: 1280, height: 1600 },
    });
    try {
      await context.route('**/*', async (route) => {
        const target = route.request().url();
        if (target.startsWith('data:') || target.startsWith('blob:')) return route.continue();
        try {
          await assertPublicHttpsUrl(target);
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();
      // The gate judges the document the browser ended on. goto's Response is that document unless the
      // page navigated again while it settled, which is exactly what a passed challenge does: Cloudflare
      // answers 403 "Just a moment…", then reloads the real page with 200. So every main-frame document
      // response is recorded and the last one wins, with goto's own Response as the fallback. (Guarded:
      // a service-worker request has no frame, and a listener that threw would surface as an unhandled
      // error, not as this capture's failure.)
      const documents: PageResponse[] = [];
      page.on('response', (res) => {
        try {
          if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) documents.push(res);
        } catch {
          // Not a main-frame document.
        }
      });
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      const signals = await readExhibitSignals(page, documents.at(-1) ?? response);
      const problems = classifyExhibit(signals);
      if (problems.length > 0) throw new ExhibitRefusedError(problems);
      pageText = signals.visibleText;
      status = signals.status;
      contentType = signals.contentType ?? 'text/html';
      finalUrl = typeof page.url === 'function' ? page.url() || url : url;
      pngBytes = Buffer.from(await page.screenshot({ fullPage: true }));
    } finally {
      await context.close();
    }
  });

  let pdfBytes: Buffer | undefined;
  let pdfText: string | undefined;
  const isPdfDoc =
    Boolean(pdfUrl) ||
    url.toLowerCase().endsWith('.pdf') ||
    finalUrl.toLowerCase().endsWith('.pdf') ||
    /application\/(?:x-)?pdf\b/i.test(contentType);
  const docUrl = pdfUrl ?? (isPdfDoc ? finalUrl : undefined);
  if (docUrl) {
    try {
      const res = await guardedFetch(docUrl, { signal: AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS) });
      if (res.ok) {
        pdfBytes = await readResponseBytesCapped(res, MAX_PDF_DOWNLOAD_BYTES);
        // Archived as a PDF, so read as one whatever the server called it.
        pdfText = (await extractText(pdfBytes, 'application/pdf')) ?? '';
      }
    } catch {
      // PDF capture is best-effort; the page screenshot is the primary record.
    }
  }

  const readableText = composeReadableText(pageText!, pdfText);
  return {
    url,
    finalUrl,
    contentType,
    status,
    capturedAt,
    pngBytes: pngBytes!,
    ...(pdfBytes ? { pdfBytes } : {}),
    readableText,
    ...(readableText === null ? { noReadableText: true as const } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
  };
}

/** Minimal cache adapter interface accepted by `captureEvidence` (implemented by `SourceCache`). */
export interface CaptureSourceCacheAdapter {
  promoteIfCached(storage: TenantStorage, url: string, pdfUrl?: string): Promise<CaptureResult | null>;
  recordRendered(storage: TenantStorage, rendered: RenderedSourceDocument): Promise<void>;
}

export interface CaptureEvidenceOptions {
  /** Optional shared source cache: promotes cached artifacts into `evidence/` without re-launching Playwright. */
  sourceCache?: CaptureSourceCacheAdapter;
  /** Optional bounded browser context semaphore (defaults to `defaultBrowserSemaphore`). */
  semaphore?: BrowserContextSemaphore;
}

/**
 * Evidence capture (SPEC.md §8, decision D): Playwright screenshot of the
 * source page, plus the PDF itself when the source is a document, plus the
 * readable text of both (the page's visible text, the PDF's text layer) as
 * evidence/<hash>.txt, so a reviewer can read what research read.
 *
 * When a `sourceCache` is supplied and already holds a same-day capture for the
 * normalized URL, it promotes the cached artifact into immutable `evidence/`
 * directly without re-launching Playwright; on a cache miss it renders once
 * (under the bounded Chromium context semaphore), writes immutable `evidence/`,
 * and populates the cache for subsequent dimensions or reads.
 *
 * Egress (SPEC-v3 §2.3): the page URL, every request the page makes
 * (including redirect hops, which Chromium issues as new requests), and the
 * PDF download all pass the public-https guard. Objects are keyed by
 * sha256(url + captured_at), so a re-capture appends a new record and never
 * overwrites the old one.
 *
 * Before anything is stored, the loaded page passes the exhibit gate
 * (classifyExhibit): a block, challenge, error, sign-in, or blank page throws
 * ExhibitRefusedError and nothing is archived — neither the screenshot nor
 * the PDF, because a finding's evidence must open on the source itself.
 *
 * The text copy is best-effort like the PDF: when there is no readable text
 * the result says so (no_readable_text), and when storing it fails the result
 * simply has neither field, as captures made before text was kept.
 */
export async function captureEvidence(
  storage: TenantStorage,
  url: string,
  pdfUrl?: string,
  opts: CaptureEvidenceOptions = {},
): Promise<CaptureResult> {
  if (opts.sourceCache) {
    try {
      const promoted = await opts.sourceCache.promoteIfCached(storage, url, pdfUrl);
      if (promoted) return promoted;
    } catch {
      // Cache promotion is an optimization; fall back cleanly to live render if unreadable.
    }
  }

  const rendered = await renderSourceDocument(url, pdfUrl, { semaphore: opts.semaphore });
  const hash = createHash('sha256').update(`${url}\n${rendered.capturedAt}`).digest('hex').slice(0, 16);

  const snapshotPath = await storage.put(`evidence/${hash}.png`, rendered.pngBytes, 'image/png');

  let pdfPath: string | undefined;
  if (rendered.pdfBytes) {
    try {
      pdfPath = await storage.put(`evidence/${hash}.pdf`, rendered.pdfBytes, 'application/pdf');
    } catch {
      // PDF capture is best-effort; the page screenshot is the primary record.
    }
  }

  const result: CaptureResult = { snapshot_path: snapshotPath, pdf_path: pdfPath, captured_at: rendered.capturedAt };
  if (rendered.readableText === null) {
    result.no_readable_text = true;
  } else {
    try {
      result.text_path = await storage.put(
        `evidence/${hash}.txt`,
        Buffer.from(rendered.readableText, 'utf8'),
        'text/plain; charset=utf-8',
      );
    } catch {
      // Like the PDF, the text copy is best-effort: without it the capture still stands.
    }
  }

  if (opts.sourceCache) {
    await opts.sourceCache.recordRendered(storage, rendered).catch(() => {
      // Cache population is best-effort and never invalidates a completed capture.
    });
  }

  return result;
}
