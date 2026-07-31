import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import type { TenantStorage } from './storage.js';

export interface CaptureResult {
  snapshot_path: string;
  pdf_path?: string;
  captured_at: string;
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

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  let snapshotPath: string;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    const png = await page.screenshot({ fullPage: true });
    snapshotPath = await storage.put(`evidence/${hash}.png`, Buffer.from(png), 'image/png');
  } finally {
    await browser.close();
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
