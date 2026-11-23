import { describe, expect, it, vi } from 'vitest';
import {
  BrowserContextSemaphore,
  DEFAULT_READ_SOURCE_MAX_BYTES,
  SourceCache,
  buildReadSourceExcerpt,
  normalizeSourceUrl,
  promoteCachedEvidence,
  readSourceWithCache,
  sourceCachePrefix,
  utcDateStamp,
  type SourceCacheEntry,
} from './source-cache.js';
import { captureEvidence, type RenderedSourceDocument } from './evidence.js';
import type { TenantStorage } from './storage.js';
import { PDF_PAGE_BREAK } from './text-extract.js';

vi.mock('@deep-fryer/research', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-fryer/research')>();
  return {
    ...actual,
    assertPublicHttpsUrl: vi.fn(async (raw: string) => {
      const u = new URL(raw);
      if (u.protocol !== 'https:') throw new actual.EgressBlockedError(raw, 'only https is allowed');
      if (u.hostname === '127.0.0.1' || u.hostname === '169.254.169.254') {
        throw new actual.EgressBlockedError(raw, `resolves to non-public address ${u.hostname}`);
      }
      return u;
    }),
  };
});

/** Immutable in-memory TenantStorage mirroring local/S3 overwrite refusal. */
function memoryStorage(label = 'memory'): TenantStorage & {
  objects: Map<string, { body: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    describe: () => label,
    async put(storagePath, body, contentType) {
      if (objects.has(storagePath)) throw new Error(`evidence object already exists: ${storagePath}`);
      objects.set(storagePath, { body: Buffer.from(body), contentType });
      return storagePath;
    },
    async get(storagePath) {
      const obj = objects.get(storagePath);
      if (!obj) {
        const err = new Error(`ENOENT: ${storagePath}`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return obj.body;
    },
  };
}

function fakeRendered(overrides: Partial<RenderedSourceDocument> = {}): RenderedSourceDocument {
  const url = overrides.url ?? 'https://www.cityofsantacruz.com/reports/housing-2025';
  const text =
    overrides.readableText !== undefined
      ? overrides.readableText
      : 'Santa Cruz Housing Report 2025. Cost-burdened renters: 54.2% of renter households.\n';
  return {
    url,
    finalUrl: overrides.finalUrl ?? url,
    contentType: 'text/html; charset=utf-8',
    status: 200,
    capturedAt: '2026-11-24T10:00:00.000Z',
    pngBytes: Buffer.from('fake-png-bytes'),
    readableText: text,
    ...(text === null ? { noReadableText: true as const } : {}),
    ...overrides,
  };
}

describe('normalizeSourceUrl & cache prefixing', () => {
  it('lowercases host, strips default port and fragments, preserves meaningful query params, and strips tracking params', () => {
    const a = normalizeSourceUrl(
      'HTTPS://DATA.CityOfNewYork.US:443/Housing/Report?year=2024&utm_source=newsletter&b=2&fbclid=xyz&a=1#page=5',
    );
    const b = normalizeSourceUrl(
      'https://data.cityofnewyork.us/Housing/Report?a=1&gclid=999&year=2024&b=2&UTM_CAMPAIGN=fall#section-3',
    );
    expect(a).toBe('https://data.cityofnewyork.us/Housing/Report?a=1&b=2&year=2024');
    expect(a).toBe(b);
  });

  it('produces TenantStorage-safe cache/<sha256>/<yyyy-mm-dd> prefixes', () => {
    const norm = normalizeSourceUrl('https://data.example.gov/report.pdf');
    const prefix = sourceCachePrefix(norm, utcDateStamp(new Date('2026-11-24T18:30:00Z')));
    expect(prefix).toMatch(/^cache\/[0-9a-f]{64}\/2026-11-24$/);
  });
});

describe('BrowserContextSemaphore', () => {
  it('bounds concurrent browser contexts strictly to maxConcurrency and releases slots on errors', async () => {
    expect(() => new BrowserContextSemaphore(0)).toThrow(RangeError);
    const sem = new BrowserContextSemaphore(3);
    let current = 0;
    let peak = 0;

    const tasks = Array.from({ length: 10 }, (_, idx) =>
      sem.run(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise((r) => setTimeout(r, 10));
        if (idx === 4) {
          current -= 1;
          throw new Error('simulated page crash');
        }
        current -= 1;
        return idx;
      }),
    );

    const settled = await Promise.allSettled(tasks);
    expect(peak).toBe(3);
    expect(sem.activeCount).toBe(0);
    expect(sem.pendingCount).toBe(0);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(9);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);
  });
});

describe('SourceCache', () => {
  it('caches misses in TenantStorage + memory and serves subsequent requests as cache hits across normalized URLs and restarts', async () => {
    const storage = memoryStorage('tenant:santa-cruz');
    const render = vi.fn(async (url: string) =>
      fakeRendered({
        url,
        finalUrl: 'https://www.cityofsantacruz.com/reports/housing-2025',
        pdfBytes: Buffer.from('%PDF-1.4 fake'),
      }),
    );
    const fixedClock = () => new Date('2026-11-24T12:00:00Z');
    const cache = new SourceCache({ render, now: fixedClock });

    // First call: cache miss -> renders once and persists under cache/<sha256>/<yyyy-mm-dd>/
    const first = await cache.getOrFetch(
      storage,
      'https://WWW.CityOfSantaCruz.com/reports/housing-2025?utm_source=test#top',
    );
    expect(first.cacheHit).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
    expect(first.entry.snapshotPath).toMatch(/^cache\/[0-9a-f]{64}\/2026-11-24\/snapshot\.png$/);
    expect(first.entry.pdfPath).toMatch(/^cache\/[0-9a-f]{64}\/2026-11-24\/document\.pdf$/);
    expect(first.entry.textPath).toMatch(/^cache\/[0-9a-f]{64}\/2026-11-24\/text\.txt$/);
    expect(first.entry.textCharCount).toBeGreaterThan(20);

    // Second call with different tracking params & fragment: instant in-memory cache hit!
    const second = await cache.getOrFetch(
      storage,
      'https://www.cityofsantacruz.com/reports/housing-2025?gclid=abc#table-2',
    );
    expect(second.cacheHit).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(second.text).toBe(first.text);

    // Fresh SourceCache instance (simulating worker restart) on same storage & day -> TenantStorage hit!
    const afterRestart = new SourceCache({ render, now: fixedClock });
    const third = await afterRestart.getOrFetch(
      storage,
      'https://www.cityofsantacruz.com/reports/housing-2025',
    );
    expect(third.cacheHit).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(third.entry.snapshotPath).toBe(first.entry.snapshotPath);

    // Next UTC day: cache miss -> re-renders into the new date bucket.
    const nextDay = new SourceCache({ render, now: () => new Date('2026-11-25T00:05:00Z') });
    const fourth = await nextDay.getOrFetch(
      storage,
      'https://www.cityofsantacruz.com/reports/housing-2025',
    );
    expect(fourth.cacheHit).toBe(false);
    expect(render).toHaveBeenCalledTimes(2);
    expect(fourth.entry.snapshotPath).toMatch(/^cache\/[0-9a-f]{64}\/2026-11-25\/snapshot\.png$/);
  });

  it('shares rendered artifacts across multi-portrait runs (different tenants) on the same day while isolating each tenant storage', async () => {
    const nycStorage = memoryStorage('tenant:nyc');
    const brooklynStorage = memoryStorage('tenant:brooklyn');
    const render = vi.fn(async (url: string) => fakeRendered({ url }));
    const cache = new SourceCache({ render, now: () => new Date('2026-11-24T12:00:00Z') });

    const nyc = await cache.getOrFetch(nycStorage, 'https://data.ny.gov/report/2025');
    expect(nyc.cacheHit).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);

    // Brooklyn hits the shared process artifact without re-launching Playwright AND writes its own tenant copy.
    const brooklyn = await cache.getOrFetch(brooklynStorage, 'https://data.ny.gov/report/2025');
    expect(brooklyn.cacheHit).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(brooklynStorage.objects.has(brooklyn.entry.snapshotPath!)).toBe(true);
    expect(brooklynStorage.objects.has(brooklyn.entry.textPath!)).toBe(true);
  });

  it('coalesces concurrent in-flight fetches for the same URL and bounds in-memory LRU size', async () => {
    const storage = memoryStorage('tenant:coalesce');
    const render = vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 15));
      return fakeRendered({ url });
    });
    const cache = new SourceCache({
      render,
      maxMemoryEntries: 2,
      now: () => new Date('2026-11-24T12:00:00Z'),
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => cache.getOrFetch(storage, 'https://example.gov/shared')),
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => !r.cacheHit)).toHaveLength(1);
    expect(results.filter((r) => r.cacheHit)).toHaveLength(4);

    // Populate two more distinct URLs to verify LRU stays strictly bounded at maxMemoryEntries = 2.
    await cache.getOrFetch(storage, 'https://example.gov/page-2');
    await cache.getOrFetch(storage, 'https://example.gov/page-3');
    expect(cache.stats().tenantEntries).toBeLessThanOrEqual(2);
    expect(cache.stats().sharedEntries).toBeLessThanOrEqual(2);
  });

  it('enforces egress guard before caching or rendering', async () => {
    const storage = memoryStorage('tenant:egress');
    const render = vi.fn(async (url: string) => fakeRendered({ url }));
    const cache = new SourceCache({ render });

    await expect(cache.getOrFetch(storage, 'http://example.gov/insecure')).rejects.toThrow(/only https/);
    await expect(cache.getOrFetch(storage, 'https://169.254.169.254/latest/meta-data')).rejects.toThrow(/non-public/);
    expect(render).not.toHaveBeenCalled();
  });
});

describe('promoteCachedEvidence & captureEvidence cache promotion', () => {
  it('promotes a cached source into immutable evidence/ in <50ms without re-launching Playwright', async () => {
    const storage = memoryStorage('tenant:promote');
    const render = vi.fn(async (url: string) =>
      fakeRendered({
        url,
        pdfBytes: Buffer.from('%PDF-1.4 cached pdf bytes'),
        readableText: 'Table 2: Uninsured residents 4.8% (2024)\n',
      }),
    );
    const cache = new SourceCache({ render, now: () => new Date('2026-11-24T12:00:00Z') });
    const url = 'https://data.example.gov/health/uninsured-2024.pdf';

    // Warm the cache via read_source / getOrFetch.
    const warmed = await cache.getOrFetch(storage, url);
    expect(warmed.cacheHit).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);

    // Promote directly via captureEvidence({ sourceCache }) — zero extra render calls!
    const started = performance.now();
    const promoted = await captureEvidence(storage, url, undefined, { sourceCache: cache });
    const elapsedMs = performance.now() - started;

    expect(render).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(50);
    expect(promoted.snapshot_path).toMatch(/^evidence\/[0-9a-f]{16}\.png$/);
    expect(promoted.pdf_path).toMatch(/^evidence\/[0-9a-f]{16}\.pdf$/);
    expect(promoted.text_path).toMatch(/^evidence\/[0-9a-f]{16}\.txt$/);
    expect(promoted.no_readable_text).toBeUndefined();
    expect((await storage.get(promoted.snapshot_path)).toString('utf8')).toBe('fake-png-bytes');
    expect((await storage.get(promoted.pdf_path!)).toString('utf8')).toBe('%PDF-1.4 cached pdf bytes');
    expect((await storage.get(promoted.text_path!)).toString('utf8')).toContain('4.8%');

    // Direct promoteCachedEvidence also creates a distinct immutable evidence object.
    const second = await promoteCachedEvidence(storage, warmed.entry, {
      capturedAt: '2026-11-24T12:05:00.000Z',
    });
    expect(second.snapshot_path).not.toBe(promoted.snapshot_path);
    expect(storage.objects.has(second.snapshot_path)).toBe(true);
  });

  it('preserves no_readable_text on promoted scanned PDFs', async () => {
    const storage = memoryStorage('tenant:scanned');
    const entry: SourceCacheEntry = {
      url: 'https://data.example.gov/scan.pdf',
      normalizedUrl: 'https://data.example.gov/scan.pdf',
      finalUrl: 'https://data.example.gov/scan.pdf',
      contentType: 'application/pdf',
      status: 200,
      capturedAt: '2026-11-24T12:00:00.000Z',
      snapshotPath: 'cache/abc/2026-11-24/snapshot.png',
      pdfPath: 'cache/abc/2026-11-24/document.pdf',
      noReadableText: true,
      textCharCount: 0,
    };
    await storage.put(entry.snapshotPath!, Buffer.from('scan-png'), 'image/png');
    await storage.put(entry.pdfPath!, Buffer.from('%PDF-scan'), 'application/pdf');

    const promoted = await promoteCachedEvidence(storage, entry);
    expect(promoted.snapshot_path).toMatch(/^evidence\/[0-9a-f]{16}\.png$/);
    expect(promoted.pdf_path).toMatch(/^evidence\/[0-9a-f]{16}\.pdf$/);
    expect(promoted.text_path).toBeUndefined();
    expect(promoted.no_readable_text).toBe(true);
  });
});

describe('buildReadSourceExcerpt & readSourceWithCache', () => {
  it('uses extractPageWindowExcerpt for multi-page PDFs with page_range and query within strict byte caps', async () => {
    const pages = Array.from({ length: 12 }, (_, idx) => {
      const pageNum = idx + 1;
      if (pageNum === 7) {
        return `Page 7 Housing Element Table 4.2: Cost-burdened renter households reached 54.2% in 2024.\n${'Detail row '.repeat(20)}`;
      }
      return `Page ${pageNum} generic municipal planning background narrative.\n${'Background text '.repeat(40)}`;
    });
    const storedPdfText = `Text of the PDF document\n\n${pages.join(PDF_PAGE_BREAK)}\n`;

    // Targeted by page_range
    const byRange = buildReadSourceExcerpt(storedPdfText, {
      url: 'https://city.example.gov/general-plan.pdf',
      pageRange: '6-8',
      maxBytes: 4096,
    });
    expect(byRange.pagesIncluded).toEqual([6, 7, 8]);
    expect(byRange.totalPages).toBe(12);
    expect(byRange.excerpt).toContain('54.2%');
    expect(byRange.truncated).toBe(true);
    expect(Buffer.byteLength(byRange.excerpt, 'utf8')).toBeLessThanOrEqual(4096);

    // Targeted by query
    const byQuery = buildReadSourceExcerpt(storedPdfText, {
      url: 'https://city.example.gov/general-plan.pdf',
      query: '54.2% cost-burdened renter',
      maxBytes: 4096,
    });
    expect(byQuery.pagesIncluded).toContain(7);
    expect(byQuery.excerpt).toContain('54.2%');
    expect(Buffer.byteLength(byQuery.excerpt, 'utf8')).toBeLessThanOrEqual(4096);
  });

  it('extracts query-focused windows for long HTML pages and bounds default excerpts to 12 KiB', async () => {
    const filler = 'Introductory municipal portal navigation and boilerplate text.\n'.repeat(300);
    const target = 'Indicator Table: Households with broadband internet subscription: 91.4% (ACS 2024).\n';
    const fullHtmlText = `${filler}${target}${filler}`;
    expect(Buffer.byteLength(fullHtmlText, 'utf8')).toBeGreaterThan(DEFAULT_READ_SOURCE_MAX_BYTES);

    const focused = buildReadSourceExcerpt(fullHtmlText, {
      url: 'https://data.example.gov/broadband',
      query: 'broadband internet 91.4%',
    });
    expect(focused.truncated).toBe(true);
    expect(focused.excerpt).toContain('91.4%');
    expect(Buffer.byteLength(focused.excerpt, 'utf8')).toBeLessThanOrEqual(DEFAULT_READ_SOURCE_MAX_BYTES);

    const cache = new SourceCache({
      render: vi.fn(async (url: string) => fakeRendered({ url, readableText: fullHtmlText })),
    });
    const first = await readSourceWithCache(cache, undefined, {
      url: 'https://data.example.gov/broadband',
      query: 'broadband 91.4%',
    });
    expect(first).toMatchObject({
      url: 'https://data.example.gov/broadband',
      final_url: 'https://data.example.gov/broadband',
      content_type: 'text/html; charset=utf-8',
      text_char_count: fullHtmlText.length,
      cache_hit: false,
      truncated: true,
    });
    expect(first.excerpt).toContain('91.4%');

    const second = await readSourceWithCache(cache, undefined, {
      url: 'https://data.example.gov/broadband',
      query: 'broadband 91.4%',
    });
    expect(second.cache_hit).toBe(true);
  });
});
