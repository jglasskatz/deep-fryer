import { createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright-core';
import type { TenantStorage } from './storage.js';

export interface CaptureResult {
  snapshot_path: string;
  pdf_path?: string;
  captured_at: string;
}

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

/**
 * Evidence capture (SPEC.md §8, decision D): Playwright screenshot of the
 * source page, plus the PDF itself when the source is a document.
 */
export async function captureEvidence(
  storage: TenantStorage,
  url: string,
  pdfUrl?: string,
): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString();
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);

  const context = await (await browser()).newContext({
    viewport: { width: 1280, height: 1600 },
  });
  let snapshotPath: string;
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    const png = await page.screenshot({ fullPage: true });
    snapshotPath = await storage.put(`evidence/${hash}.png`, Buffer.from(png), 'image/png');
  } finally {
    await context.close();
  }

  let pdfPath: string | undefined;
  const docUrl = pdfUrl ?? (url.toLowerCase().endsWith('.pdf') ? url : undefined);
  if (docUrl) {
    try {
      const res = await fetch(docUrl, { redirect: 'follow' });
      if (res.ok) {
        const body = Buffer.from(await res.arrayBuffer());
        pdfPath = await storage.put(`evidence/${hash}.pdf`, body, 'application/pdf');
      }
    } catch {
      // PDF capture is best-effort; the page screenshot is the primary record.
    }
  }

  return { snapshot_path: snapshotPath, pdf_path: pdfPath, captured_at: capturedAt };
}
