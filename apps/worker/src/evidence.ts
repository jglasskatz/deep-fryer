import { createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright-core';
import { normalizeForMatch, SOURCE_TEXT_MAX_CHARS } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';

export interface CaptureResult {
  snapshot_path: string;
  pdf_path?: string;
  captured_at: string;
}

/**
 * Everything a capture learns about a source — the knowledge-base record
 * (SPEC.md §8). The session tool returns only CaptureResult to the model;
 * the rest flows to the sources table via runSession's onCapture hook.
 */
export interface SourceCaptureRecord extends CaptureResult {
  url: string;
  /** sha256(url).slice(0,12) — the legacy evidence filename stem. */
  url_hash: string;
  /** sha256 of normalized title+text; of the PNG bytes when no text. */
  content_hash: string;
  title: string | null;
  /** Extracted text, truncated to SOURCE_TEXT_MAX_CHARS; null when none. */
  text: string | null;
  text_source: 'html' | 'pdf' | null;
  media_type: 'html' | 'pdf';
}

const PDF_MAX_BYTES = 20 * 1024 * 1024;

// One browser per worker process; each capture gets an isolated context.
// Launching Chromium per capture would cost seconds on every source a run
// touches. closeEvidenceBrowser() runs at the end of each research run.
let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  return browserPromise;
}

export async function closeEvidenceBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

async function extractPdfText(bytes: Buffer): Promise<string | null> {
  if (bytes.length > PDF_MAX_BYTES) return null;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(doc, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join('\n') : text).trim();
    return merged ? merged.slice(0, SOURCE_TEXT_MAX_CHARS) : null;
  } catch {
    return null;
  }
}

/**
 * Evidence capture (SPEC.md §8): Playwright screenshot of the source page,
 * the PDF itself when the source is a document, and the extracted text that
 * feeds the source knowledge base. Exhibits are written twice: the mutable
 * url-hash path (the "latest capture of this URL" existing findings resolve)
 * and an immutable content-addressed copy under evidence/by-content/ — the
 * returned paths are the immutable ones, so new findings and sources rows
 * survive later re-captures of a changed page.
 */
export async function captureEvidence(
  storage: TenantStorage,
  url: string,
  pdfUrl?: string,
): Promise<SourceCaptureRecord> {
  const capturedAt = new Date().toISOString();
  const urlHash = createHash('sha256').update(url).digest('hex').slice(0, 12);

  const context = await (await browser()).newContext({
    viewport: { width: 1280, height: 1600 },
  });
  let png: Buffer;
  let title: string | null = null;
  let htmlText: string | null = null;
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    png = Buffer.from(await page.screenshot({ fullPage: true }));
    try {
      title = (await page.title()) || null;
      const body = await page.innerText('body');
      htmlText = body?.trim() ? body.trim().slice(0, SOURCE_TEXT_MAX_CHARS) : null;
    } catch {
      // Text extraction is best-effort; the screenshot is the primary record.
    }
  } finally {
    await context.close();
  }

  let pdfBytes: Buffer | null = null;
  const docUrl = pdfUrl ?? (url.toLowerCase().endsWith('.pdf') ? url : undefined);
  if (docUrl) {
    try {
      const res = await fetch(docUrl, { redirect: 'follow' });
      if (res.ok) pdfBytes = Buffer.from(await res.arrayBuffer());
    } catch {
      // PDF capture is best-effort; the page screenshot is the primary record.
    }
  }

  const isPdfSource = url.toLowerCase().endsWith('.pdf');
  let text = htmlText;
  let textSource: 'html' | 'pdf' | null = htmlText ? 'html' : null;
  if (pdfBytes && (isPdfSource || !htmlText)) {
    const pdfText = await extractPdfText(pdfBytes);
    if (pdfText) {
      text = pdfText;
      textSource = 'pdf';
    }
  }

  // Content identity: normalized text when we have it (render churn — fonts,
  // banners, timing — would make PNG bytes a new "source" on every retry);
  // the snapshot bytes only when the page yielded no text at all.
  const contentHash = text
    ? createHash('sha256').update(normalizeForMatch(`${title ?? ''}\n${text}`)).digest('hex')
    : createHash('sha256').update(png).digest('hex');
  const contentStem = contentHash.slice(0, 12);

  await storage.put(`evidence/${urlHash}.png`, png, 'image/png');
  const snapshotPath = await storage.put(`evidence/by-content/${contentStem}.png`, png, 'image/png');
  let pdfPath: string | undefined;
  if (pdfBytes) {
    await storage.put(`evidence/${urlHash}.pdf`, pdfBytes, 'application/pdf');
    pdfPath = await storage.put(
      `evidence/by-content/${contentStem}.pdf`,
      pdfBytes,
      'application/pdf',
    );
  }

  return {
    snapshot_path: snapshotPath,
    pdf_path: pdfPath,
    captured_at: capturedAt,
    url,
    url_hash: urlHash,
    content_hash: contentHash,
    title,
    text,
    text_source: textSource,
    media_type: isPdfSource || (!htmlText && Boolean(pdfBytes)) ? 'pdf' : 'html',
  };
}
