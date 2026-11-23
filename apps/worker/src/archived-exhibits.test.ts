import { describe, expect, it, vi } from 'vitest';
import {
  ARCHIVED_PDF,
  ARCHIVED_PDF_EXCERPT,
  MAX_VERIFIER_PDF_BYTES,
  MAX_VERIFIER_PDF_PAGES,
  loadArchivedExhibits,
  loadFindingExhibits,
} from './archived-exhibits.js';
import { CAPTURED_TEXT_EXCERPT_HEADER, OVERSIZED_PDF_EXCERPT_HEADER, PDF_PAGE_BREAK } from './text-extract.js';
import type { IndicatorFindingPayload } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';

const evidence = { snapshot_path: 'evidence/capture.png', pdf_path: 'evidence/capture.pdf', captured_at: '2026-10-23T12:00:00Z' };
const store = (get: TenantStorage['get']): TenantStorage => ({ get, put: vi.fn(), describe: () => 'test' });

describe('archived verifier exhibits', () => {
  it('loads the actual captured bytes under fixed workspace filenames, PDF first', async () => {
    const get = vi.fn(async (key: string) => Buffer.from(key));
    const loaded = await loadArchivedExhibits(store(get), evidence);
    expect(loaded.names).toEqual(['archived-source.pdf', 'archived-snapshot.png']);
    expect(loaded.exhibits.pdf).toEqual(Buffer.from(evidence.pdf_path));
    expect(loaded.exhibits.snapshot).toEqual(Buffer.from(evidence.snapshot_path));
    expect(loaded.note).toBe('');
  });

  it('retains a screenshot when a large PDF is omitted, explicitly explaining the limit', async () => {
    const loaded = await loadArchivedExhibits(store(async (key) => {
      if (key.endsWith('.pdf')) throw new Error('archived exhibit exceeds 33554432 bytes');
      return Buffer.from('snapshot');
    }), evidence);
    expect(loaded.names).toEqual(['archived-snapshot.png']);
    expect(loaded.exhibits.pdf).toBeUndefined();
    expect(loaded.note).toContain('pdf was not loaded: it exceeds the 32 MiB');
  });

  it('never passes URLs, traversal, or a neighboring tenant prefix to storage', async () => {
    for (const snapshot_path of ['https://source.example/a.png', '../other/evidence/a.png', 'tenant-other/evidence/a.png', '/etc/passwd', 'evidence/a.pdf']) {
      const get = vi.fn();
      const loaded = await loadArchivedExhibits(store(get), { snapshot_path, captured_at: evidence.captured_at });
      expect(get).not.toHaveBeenCalled();
      expect(loaded.names).toEqual([]);
      expect(loaded.note).toContain('invalid evidence path');
    }
  });

  it('explains unavailable archives without exposing storage credentials in the prompt', async () => {
    const loaded = await loadArchivedExhibits(store(async () => { throw new Error('S3 secret credential detail'); }), evidence);
    expect(loaded.names).toEqual([]);
    expect(loaded.note).toContain('snapshot was not loaded');
    expect(loaded.note).toContain('pdf was not loaded');
    expect(loaded.note).not.toContain('secret');
  });

  it('loads action captures under generated names and identifies each omitted action exhibit', async () => {
    const payload = { evidence, narrative_draft: { context: 'Supported context', actions: [
      { text: 'Join a hearing', source_url: 'https://city.example/hearings', evidence: { ...evidence, snapshot_path: 'evidence/action.png', pdf_path: undefined } },
      { text: 'Enroll', source_url: 'https://city.example/enroll', evidence: { ...evidence, snapshot_path: 'evidence/missing.png', pdf_path: undefined } },
    ] } } as IndicatorFindingPayload;
    const result = await loadFindingExhibits(store(async (key) => {
      if (key.includes('missing')) throw new Error('missing');
      return Buffer.from(key);
    }), payload);
    expect(result.names).toEqual(['archived-source.pdf', 'archived-snapshot.png', 'action-1-snapshot.png']);
    expect(result.exhibits.additional).toEqual([{ filename: 'action-1-snapshot.png', body: Buffer.from('evidence/action.png') }]);
    expect(result.note).toContain('Action 2: The archived snapshot was not loaded');
  });

  it('extracts a bounded page-window text excerpt when an archived PDF exceeds 32 MiB and text_path exists', async () => {
    const pages = [
      'Cover page: Comprehensive City Report',
      'Methodology overview',
      'Table 8: Cost-burdened renters stood at 54.2% in 2024.',
      'Appendix notes',
    ];
    const textCopy = `Text of the captured page\n\nDownload report\n\nText of the PDF document\n\n${pages.join(PDF_PAGE_BREAK)}\n`;
    const payload = {
      kind: 'indicator',
      indicator_slug: 'cost-burdened-renters',
      name: 'Cost-burdened renters',
      value: 54.2,
      unit: '%',
      year: 2024,
      source: 'City Planning',
      source_url: 'https://city.example/huge-report.pdf#page=3',
      notes: 'Table 8 on p. 3',
      evidence: {
        ...evidence,
        text_path: 'evidence/capture.txt',
      },
    } as IndicatorFindingPayload;

    const result = await loadFindingExhibits(
      store(async (key) => {
        if (key.endsWith('.pdf')) throw new Error('archived exhibit exceeds 33554432 bytes');
        if (key === 'evidence/capture.txt') return Buffer.from(textCopy, 'utf8');
        return Buffer.from('snapshot');
      }),
      payload,
    );

    expect(result.names).toEqual([ARCHIVED_PDF_EXCERPT, 'archived-snapshot.png']);
    expect(result.exhibits.pdf).toBeUndefined();
    expect(result.exhibits.pdfExcerpt).toBeDefined();
    const excerptText = result.exhibits.pdfExcerpt!.toString('utf8');
    expect(excerptText).toContain(OVERSIZED_PDF_EXCERPT_HEADER);
    expect(excerptText).toContain('54.2%');
    expect(result.note).toContain('exceeds the 32 MiB archive-reading limit');
    expect(result.note).toContain(ARCHIVED_PDF_EXCERPT);
  });

  it('never reads an invalid or traversal text_path when falling back from an oversized PDF', async () => {
    const get = vi.fn(async (key: string) => {
      if (key.endsWith('.pdf')) throw new Error('archived exhibit exceeds 33554432 bytes');
      return Buffer.from('snapshot');
    });
    const loaded = await loadArchivedExhibits(store(get), {
      ...evidence,
      text_path: '../other-tenant/evidence/secret.txt',
    });
    expect(get).not.toHaveBeenCalledWith('../other-tenant/evidence/secret.txt');
    expect(loaded.exhibits.pdfExcerpt).toBeUndefined();
    expect(loaded.note).toContain('pdf was not loaded: it exceeds the 32 MiB');
  });

  it('always mounts archived-source-excerpt.txt whenever text_path exists (small PDF and HTML page)', async () => {
    const htmlLoaded = await loadArchivedExhibits(
      store(async (key) => Buffer.from(key.endsWith('.txt') ? 'Renters paying over 30%: 54.2%.' : 'png')),
      { snapshot_path: 'evidence/page.png', text_path: 'evidence/page.txt', captured_at: evidence.captured_at },
    );
    expect(htmlLoaded.names).toEqual([ARCHIVED_PDF_EXCERPT, 'archived-snapshot.png']);
    expect(htmlLoaded.exhibits.pdfExcerpt!.toString('utf8')).toContain(CAPTURED_TEXT_EXCERPT_HEADER);
    expect(htmlLoaded.exhibits.pdfExcerpt!.toString('utf8')).toContain('54.2%');
    expect(htmlLoaded.note).toBe('');

    const smallPdfLoaded = await loadArchivedExhibits(
      store(async (key) => Buffer.from(key.endsWith('.txt') ? 'Page 1 text\n\f\nPage 2 text 54.2%' : key)),
      { ...evidence, text_path: 'evidence/capture.txt' },
      { claimedValue: 54.2 },
    );
    expect(smallPdfLoaded.names).toEqual([ARCHIVED_PDF, ARCHIVED_PDF_EXCERPT, 'archived-snapshot.png']);
    expect(smallPdfLoaded.exhibits.pdf).toBeDefined();
    expect(smallPdfLoaded.exhibits.pdfExcerpt).toBeDefined();
    expect(smallPdfLoaded.note).toBe('');
  });

  it('omits raw archived-source.pdf when PDF exceeds 8 MiB or 40 pages, mounting excerpt cleanly without poisoning actionArchiveNote', async () => {
    const manyPages = Array.from({ length: MAX_VERIFIER_PDF_PAGES + 5 }, (_, i) => `Page ${i + 1} content ${i === 20 ? '54.2%' : ''}`).join(PDF_PAGE_BREAK);
    const getLargePages = vi.fn(async (key: string) => {
      if (key.endsWith('.txt')) return Buffer.from(manyPages, 'utf8');
      if (key.endsWith('.pdf')) return Buffer.from('should-not-need-pdf');
      return Buffer.from('snapshot');
    });
    const payload = {
      kind: 'indicator',
      indicator_slug: 'cost-burdened-renters',
      name: 'Cost-burdened renters',
      value: 54.2,
      unit: '%',
      year: 2024,
      source: 'City Plan',
      source_url: 'https://city.example/plan.pdf',
      evidence: { ...evidence, text_path: 'evidence/plan.txt' },
      narrative_draft: {
        context: 'Grounded context.',
        actions: [
          {
            text: 'Apply for rent relief',
            source_url: 'https://city.example/relief',
            evidence: { snapshot_path: 'evidence/action-ok.png', captured_at: evidence.captured_at },
          },
        ],
      },
    } as IndicatorFindingPayload;

    const overPages = await loadFindingExhibits(store(getLargePages), payload);
    expect(overPages.exhibits.pdf).toBeUndefined();
    expect(overPages.exhibits.pdfExcerpt).toBeDefined();
    expect(overPages.names).toContain(ARCHIVED_PDF_EXCERPT);
    expect(overPages.note).toContain('45 pages');
    // Crucial P0.1 fix: main exhibit excerpt disclosure must NOT populate actionArchiveNote!
    expect(overPages.actionArchiveNote).toBe('');

    // >8 MiB PDF with 2 pages: also omits raw PDF in favor of excerpt.
    const bigBytes = Buffer.alloc(MAX_VERIFIER_PDF_BYTES + 1024, 65);
    const overBytes = await loadArchivedExhibits(
      store(async (key) => {
        if (key.endsWith('.pdf')) return bigBytes;
        if (key.endsWith('.txt')) return Buffer.from(`Intro${PDF_PAGE_BREAK}Table: 54.2%`, 'utf8');
        return Buffer.from('snapshot');
      }),
      { ...evidence, text_path: 'evidence/big.txt' },
      { claimedValue: 54.2 },
    );
    expect(overBytes.exhibits.pdf).toBeUndefined();
    expect(overBytes.exhibits.pdfExcerpt).toBeDefined();
    expect(overBytes.note).toContain('8 MiB direct-read limit');
    expect(overBytes.unreadableNote).toBe('');
  });
});
