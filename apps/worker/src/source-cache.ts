import { createHash } from 'node:crypto';
import { assertPublicHttpsUrl } from '@deep-fryer/research';
import {
  BrowserContextSemaphore,
  MAX_BROWSER_CONTEXTS,
  defaultBrowserSemaphore,
  renderSourceDocument,
  type CaptureResult,
  type CaptureSourceCacheAdapter,
  type RenderedSourceDocument,
} from './evidence.js';
import type { TenantStorage } from './storage.js';
import { extractPageWindowExcerpt, extractPdfTextPages } from './text-extract.js';

export { BrowserContextSemaphore, MAX_BROWSER_CONTEXTS, defaultBrowserSemaphore };

/** Default maximum entries held in the per-process in-memory LRU cache. */
export const DEFAULT_SOURCE_CACHE_MAX_ENTRIES = 128;
/** Default maximum total raw artifact bytes held in process memory (32 MiB). */
export const DEFAULT_SOURCE_CACHE_MAX_MEMORY_BYTES = 32 * 1024 * 1024;
/** Single PDF larger than this is persisted to storage without pinning its raw bytes in RAM. */
const MAX_IN_MEMORY_PDF_BYTES = 8 * 1024 * 1024;
/** Default byte cap on `mcp__evidence__read_source` returned excerpts (12 KiB). */
export const DEFAULT_READ_SOURCE_MAX_BYTES = 12 * 1024;

const TRACKING_QUERY_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'igshid',
  'ref_src',
  'ref_url',
  'yclid',
  'oly_enc_id',
  'oly_anon_id',
  'vero_id',
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lower);
}

/**
 * Pure: normalize a source URL deterministically for content-addressed caching.
 * Lowercases scheme/host (and strips default port), strips the fragment, strips
 * known tracking query parameters (`utm_*`, `fbclid`, `gclid`, ...), and sorts
 * remaining query parameters so semantically identical URLs share one cache key.
 */
export function normalizeSourceUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = '';
  const kept: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const nextParams = new URLSearchParams();
  for (const [key, value] of kept) nextParams.append(key, value);
  const query = nextParams.toString();
  parsed.search = query ? `?${query}` : '';
  return parsed.toString();
}

/** UTC `YYYY-MM-DD` bucket stamp for same-day source cache entries. */
export function utcDateStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** SHA-256 hex digest keying one normalized URL (or URL + distinct PDF URL pair). */
export function sourceCacheHash(normalizedUrl: string, normalizedPdfUrl?: string): string {
  const material =
    normalizedPdfUrl && normalizedPdfUrl !== normalizedUrl
      ? `${normalizedUrl}\n${normalizedPdfUrl}`
      : normalizedUrl;
  return createHash('sha256').update(material).digest('hex');
}

/** TenantStorage prefix `cache/<sha256(normalizedUrl)>/<yyyy-mm-dd>`. */
export function sourceCachePrefix(
  normalizedUrl: string,
  dateStamp: string,
  normalizedPdfUrl?: string,
): string {
  return `cache/${sourceCacheHash(normalizedUrl, normalizedPdfUrl)}/${dateStamp}`;
}

export interface SourceCacheEntry {
  url: string;
  normalizedUrl: string;
  finalUrl: string;
  contentType: string;
  status?: number;
  capturedAt: string;
  textPath?: string;
  pdfPath?: string;
  snapshotPath?: string;
  noReadableText?: true;
  textCharCount: number;
  pdfUrl?: string;
}

export interface InMemoryArtifactBytes {
  pngBytes?: Buffer;
  pdfBytes?: Buffer;
  textBytes?: Buffer;
}

export interface SourceCacheFetchResult {
  entry: SourceCacheEntry;
  text: string | null;
  cacheHit: boolean;
}

interface SharedMemoryArtifact {
  entry: SourceCacheEntry;
  text: string | null;
  pngBytes?: Buffer;
  pdfBytes?: Buffer;
  textBytes?: Buffer;
  approxBytes: number;
}

export interface SourceCacheOptions {
  /** Max distinct entries kept in process memory (LRU). Default: 128. */
  maxMemoryEntries?: number;
  /** Max total raw artifact bytes kept in process memory (LRU). Default: 32 MiB. */
  maxMemoryBytes?: number;
  /** Bounded Chromium context semaphore (default: shared `MAX_BROWSER_CONTEXTS = 6`). */
  semaphore?: BrowserContextSemaphore;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Injectable renderer for unit tests without launching Playwright. */
  render?: (
    url: string,
    pdfUrl?: string,
    opts?: { semaphore?: BrowserContextSemaphore },
  ) => Promise<RenderedSourceDocument>;
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 'EEXIST') return true;
  return typeof e.message === 'string' && /already exists/i.test(e.message);
}

/** Best-effort write that treats an immutable collision on the same day's cache key as a no-op. */
async function putIdempotent(
  storage: TenantStorage,
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  try {
    return await storage.put(storagePath, body, contentType);
  } catch (err) {
    if (isAlreadyExistsError(err)) return storagePath;
    throw err;
  }
}

function isValidCacheEntry(raw: unknown): raw is SourceCacheEntry {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.url === 'string' &&
    typeof e.finalUrl === 'string' &&
    typeof e.contentType === 'string' &&
    typeof e.capturedAt === 'string' &&
    typeof e.textCharCount === 'number'
  );
}

/**
 * Promote a cached source artifact into immutable `evidence/<hash>.*` storage
 * without re-launching Playwright or re-fetching the network.
 */
export async function promoteCachedEvidence(
  storage: TenantStorage,
  cacheEntry: SourceCacheEntry,
  opts: { capturedAt?: string; inMemoryBytes?: InMemoryArtifactBytes } = {},
): Promise<CaptureResult> {
  const pngBytes =
    opts.inMemoryBytes?.pngBytes ??
    (cacheEntry.snapshotPath ? await storage.get(cacheEntry.snapshotPath) : undefined);
  if (!pngBytes) {
    throw new Error('cached source entry has no snapshot to promote');
  }

  let capturedAt = opts.capturedAt ?? new Date().toISOString();
  let hash = createHash('sha256').update(`${cacheEntry.url}\n${capturedAt}`).digest('hex').slice(0, 16);
  let snapshotPath: string;
  try {
    snapshotPath = await storage.put(`evidence/${hash}.png`, pngBytes, 'image/png');
  } catch (err) {
    // Two rapid promotions of the same URL in the same millisecond: advance timestamp by 1ms
    // unless caller pinned `capturedAt` explicitly.
    if (!opts.capturedAt && isAlreadyExistsError(err)) {
      capturedAt = new Date(Date.parse(capturedAt) + 1).toISOString();
      hash = createHash('sha256').update(`${cacheEntry.url}\n${capturedAt}`).digest('hex').slice(0, 16);
      snapshotPath = await storage.put(`evidence/${hash}.png`, pngBytes, 'image/png');
    } else {
      throw err;
    }
  }

  let pdfPath: string | undefined;
  if (opts.inMemoryBytes?.pdfBytes || cacheEntry.pdfPath) {
    try {
      const pdfBytes = opts.inMemoryBytes?.pdfBytes ?? (await storage.get(cacheEntry.pdfPath!));
      pdfPath = await storage.put(`evidence/${hash}.pdf`, pdfBytes, 'application/pdf');
    } catch {
      // Best-effort (e.g. cached PDF exceeded 32 MiB storage read cap); screenshot stands.
    }
  }

  let textPath: string | undefined;
  if (opts.inMemoryBytes?.textBytes || cacheEntry.textPath) {
    try {
      const textBytes = opts.inMemoryBytes?.textBytes ?? (await storage.get(cacheEntry.textPath!));
      textPath = await storage.put(`evidence/${hash}.txt`, textBytes, 'text/plain; charset=utf-8');
    } catch {
      // Best-effort like captureEvidence.
    }
  }

  const result: CaptureResult = {
    snapshot_path: snapshotPath,
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
    ...(textPath ? { text_path: textPath } : {}),
    ...(cacheEntry.noReadableText || (!textPath && cacheEntry.textCharCount === 0)
      ? { no_readable_text: true as const }
      : {}),
    captured_at: capturedAt,
  };
  return result;
}

/**
 * Shared content-addressed source cache backed by `TenantStorage`
 * (`cache/<sha256(normalizedUrl)>/<yyyy-mm-dd>/*`) plus a bounded per-process
 * in-memory LRU cache and in-flight request coalescing.
 *
 * Multiple dimensions (or multi-portrait runs on the same day) share rendered
 * Playwright pages, downloaded PDFs, and extracted text instead of re-fetching
 * and re-rendering the same URL. All Playwright renders run through the
 * bounded `BrowserContextSemaphore` (`MAX_BROWSER_CONTEXTS = 6` by default).
 */
export class SourceCache implements CaptureSourceCacheAdapter {
  private readonly maxMemoryEntries: number;
  private readonly maxMemoryBytes: number;
  readonly semaphore: BrowserContextSemaphore;
  private readonly now: () => Date;
  private readonly render: (
    url: string,
    pdfUrl?: string,
    opts?: { semaphore?: BrowserContextSemaphore },
  ) => Promise<RenderedSourceDocument>;

  /** Per-tenant fast index keyed by `${storage.describe()}::${dateStamp}::${hash}`. */
  private readonly tenantIndex = new Map<string, { entry: SourceCacheEntry; text: string | null }>();
  /** Process-wide bounded LRU artifact cache keyed by `${dateStamp}::${hash}` for cross-portrait reuse. */
  private readonly sharedArtifacts = new Map<string, SharedMemoryArtifact>();
  private sharedBytes = 0;
  /** Coalesces concurrent fetches for the same `${dateStamp}::${hash}` so Chromium runs once. */
  private readonly inFlight = new Map<string, Promise<SharedMemoryArtifact>>();

  constructor(options: SourceCacheOptions = {}) {
    this.maxMemoryEntries = Math.max(1, options.maxMemoryEntries ?? DEFAULT_SOURCE_CACHE_MAX_ENTRIES);
    this.maxMemoryBytes = Math.max(64 * 1024, options.maxMemoryBytes ?? DEFAULT_SOURCE_CACHE_MAX_MEMORY_BYTES);
    this.semaphore = options.semaphore ?? defaultBrowserSemaphore;
    this.now = options.now ?? (() => new Date());
    this.render = options.render ?? renderSourceDocument;
  }

  /** Clear all in-memory entries (useful in tests). */
  clear(): void {
    this.tenantIndex.clear();
    this.sharedArtifacts.clear();
    this.inFlight.clear();
    this.sharedBytes = 0;
  }

  /** Current in-memory footprint for diagnostics and tests. */
  stats(): { tenantEntries: number; sharedEntries: number; sharedBytes: number } {
    return {
      tenantEntries: this.tenantIndex.size,
      sharedEntries: this.sharedArtifacts.size,
      sharedBytes: this.sharedBytes,
    };
  }

  private keysFor(url: string, pdfUrl?: string): {
    normalizedUrl: string;
    normalizedPdfUrl?: string;
    dateStamp: string;
    hash: string;
    prefix: string;
    sharedKey: string;
  } {
    const normalizedUrl = normalizeSourceUrl(url);
    const normalizedPdfUrl = pdfUrl ? normalizeSourceUrl(pdfUrl) : undefined;
    const dateStamp = utcDateStamp(this.now());
    const hash = sourceCacheHash(normalizedUrl, normalizedPdfUrl);
    const prefix = `cache/${hash}/${dateStamp}`;
    const sharedKey = `${dateStamp}::${hash}`;
    return { normalizedUrl, normalizedPdfUrl, dateStamp, hash, prefix, sharedKey };
  }

  private setTenantIndex(tenantKey: string, value: { entry: SourceCacheEntry; text: string | null }): void {
    if (this.tenantIndex.has(tenantKey)) this.tenantIndex.delete(tenantKey);
    this.tenantIndex.set(tenantKey, value);
    while (this.tenantIndex.size > this.maxMemoryEntries) {
      const oldest = this.tenantIndex.keys().next().value;
      if (oldest === undefined) break;
      this.tenantIndex.delete(oldest);
    }
  }

  private setSharedArtifact(sharedKey: string, artifact: SharedMemoryArtifact): void {
    const existing = this.sharedArtifacts.get(sharedKey);
    if (existing) {
      this.sharedBytes -= existing.approxBytes;
      this.sharedArtifacts.delete(sharedKey);
    }
    // Never retain a single artifact that exceeds the entire memory budget.
    if (artifact.approxBytes > this.maxMemoryBytes) return;
    this.sharedArtifacts.set(sharedKey, artifact);
    this.sharedBytes += artifact.approxBytes;

    while (
      this.sharedArtifacts.size > this.maxMemoryEntries ||
      this.sharedBytes > this.maxMemoryBytes
    ) {
      const oldestKey = this.sharedArtifacts.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.sharedArtifacts.get(oldestKey);
      this.sharedArtifacts.delete(oldestKey);
      if (oldest) this.sharedBytes -= oldest.approxBytes;
    }
  }

  private getSharedArtifact(sharedKey: string): SharedMemoryArtifact | undefined {
    const found = this.sharedArtifacts.get(sharedKey);
    if (!found) return undefined;
    // Touch LRU order.
    this.sharedArtifacts.delete(sharedKey);
    this.sharedArtifacts.set(sharedKey, found);
    return found;
  }

  private async persistArtifactToStorage(
    storage: TenantStorage,
    prefix: string,
    baseEntry: SourceCacheEntry,
    bytes: InMemoryArtifactBytes,
  ): Promise<SourceCacheEntry> {
    let snapshotPath = baseEntry.snapshotPath;
    if (bytes.pngBytes) {
      snapshotPath = await putIdempotent(storage, `${prefix}/snapshot.png`, bytes.pngBytes, 'image/png');
    }
    let pdfPath = baseEntry.pdfPath;
    if (bytes.pdfBytes) {
      try {
        pdfPath = await putIdempotent(storage, `${prefix}/document.pdf`, bytes.pdfBytes, 'application/pdf');
      } catch {
        pdfPath = undefined;
      }
    }
    let textPath = baseEntry.textPath;
    if (bytes.textBytes) {
      try {
        textPath = await putIdempotent(storage, `${prefix}/text.txt`, bytes.textBytes, 'text/plain; charset=utf-8');
      } catch {
        textPath = undefined;
      }
    }
    const persisted: SourceCacheEntry = {
      ...baseEntry,
      ...(snapshotPath ? { snapshotPath } : {}),
      ...(pdfPath ? { pdfPath } : {}),
      ...(textPath ? { textPath } : {}),
    };
    await putIdempotent(
      storage,
      `${prefix}/meta.json`,
      Buffer.from(JSON.stringify(persisted), 'utf8'),
      'application/json',
    ).catch(() => {
      // Meta write failure is non-fatal; in-memory cache still holds the entry.
    });
    return persisted;
  }

  private async readFromStorage(
    storage: TenantStorage,
    prefix: string,
  ): Promise<{ entry: SourceCacheEntry; text: string | null } | null> {
    let metaRaw: Buffer;
    try {
      metaRaw = await storage.get(`${prefix}/meta.json`);
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(metaRaw.toString('utf8'));
    } catch {
      return null;
    }
    if (!isValidCacheEntry(parsed)) return null;
    let text: string | null = null;
    if (parsed.textPath) {
      try {
        text = (await storage.get(parsed.textPath)).toString('utf8');
      } catch {
        text = null;
      }
    }
    return { entry: parsed, text };
  }

  /**
   * Look up a cached source without triggering a network render. Checks the
   * in-memory per-tenant map, persistent `TenantStorage`, and shared process
   * memory (materializing into `storage` on cross-portrait hits).
   */
  async lookup(
    storage: TenantStorage | undefined,
    url: string,
    pdfUrl?: string,
  ): Promise<{ entry: SourceCacheEntry; text: string | null; inMemoryBytes?: InMemoryArtifactBytes } | null> {
    const { prefix, sharedKey } = this.keysFor(url, pdfUrl);
    const tenantKey = storage ? `${storage.describe()}::${sharedKey}` : null;

    if (tenantKey) {
      const mem = this.tenantIndex.get(tenantKey);
      if (mem) {
        this.setTenantIndex(tenantKey, mem);
        const shared = this.getSharedArtifact(sharedKey);
        return {
          entry: mem.entry,
          text: mem.text,
          ...(shared ? { inMemoryBytes: { pngBytes: shared.pngBytes, pdfBytes: shared.pdfBytes, textBytes: shared.textBytes } } : {}),
        };
      }
    }

    if (storage) {
      const stored = await this.readFromStorage(storage, prefix);
      if (stored) {
        this.setTenantIndex(tenantKey!, stored);
        const shared = this.getSharedArtifact(sharedKey);
        return {
          entry: stored.entry,
          text: stored.text,
          ...(shared ? { inMemoryBytes: { pngBytes: shared.pngBytes, pdfBytes: shared.pdfBytes, textBytes: shared.textBytes } } : {}),
        };
      }
    }

    const shared = this.getSharedArtifact(sharedKey);
    if (shared) {
      if (storage) {
        const entry = await this.persistArtifactToStorage(storage, prefix, shared.entry, {
          pngBytes: shared.pngBytes,
          pdfBytes: shared.pdfBytes,
          textBytes: shared.textBytes,
        });
        this.setTenantIndex(tenantKey!, { entry, text: shared.text });
        return {
          entry,
          text: shared.text,
          inMemoryBytes: { pngBytes: shared.pngBytes, pdfBytes: shared.pdfBytes, textBytes: shared.textBytes },
        };
      }
      return {
        entry: shared.entry,
        text: shared.text,
        inMemoryBytes: { pngBytes: shared.pngBytes, pdfBytes: shared.pdfBytes, textBytes: shared.textBytes },
      };
    }

    return null;
  }

  /**
   * Populate the cache from an already-rendered document (called by
   * `captureEvidence` on a cache miss so subsequent `read_source` or
   * `capture_evidence` calls hit immediately).
   */
  async recordRendered(storage: TenantStorage, rendered: RenderedSourceDocument): Promise<void> {
    const { normalizedUrl, prefix, sharedKey } = this.keysFor(rendered.url, rendered.pdfUrl);
    const tenantKey = `${storage.describe()}::${sharedKey}`;
    const textBytes = rendered.readableText !== null ? Buffer.from(rendered.readableText, 'utf8') : undefined;
    const baseEntry: SourceCacheEntry = {
      url: rendered.url,
      normalizedUrl,
      finalUrl: rendered.finalUrl,
      contentType: rendered.contentType,
      ...(rendered.status !== undefined ? { status: rendered.status } : {}),
      capturedAt: rendered.capturedAt,
      ...(rendered.noReadableText ? { noReadableText: true as const } : {}),
      textCharCount: rendered.readableText?.length ?? 0,
      ...(rendered.pdfUrl ? { pdfUrl: rendered.pdfUrl } : {}),
    };
    const persisted = await this.persistArtifactToStorage(storage, prefix, baseEntry, {
      pngBytes: rendered.pngBytes,
      pdfBytes: rendered.pdfBytes,
      textBytes,
    });
    this.setTenantIndex(tenantKey, { entry: persisted, text: rendered.readableText });

    const keepPdfInMem = rendered.pdfBytes && rendered.pdfBytes.byteLength <= MAX_IN_MEMORY_PDF_BYTES
      ? rendered.pdfBytes
      : undefined;
    const approxBytes =
      rendered.pngBytes.byteLength +
      (keepPdfInMem?.byteLength ?? 0) +
      (textBytes?.byteLength ?? 0) +
      1024;
    this.setSharedArtifact(sharedKey, {
      entry: persisted,
      text: rendered.readableText,
      pngBytes: rendered.pngBytes,
      pdfBytes: keepPdfInMem,
      textBytes,
      approxBytes,
    });
  }

  /**
   * Look up a cached source for `(url, pdfUrl)` or render it once through
   * Playwright/`unpdf` under the bounded semaphore, coalescing concurrent
   * misses on the same URL.
   */
  async getOrFetch(
    storage: TenantStorage | undefined,
    url: string,
    pdfUrl?: string,
  ): Promise<SourceCacheFetchResult> {
    // Always enforce egress guard before touching cache keys or storage.
    await assertPublicHttpsUrl(url);
    if (pdfUrl) await assertPublicHttpsUrl(pdfUrl);

    const hit = await this.lookup(storage, url, pdfUrl);
    if (hit) {
      return { entry: hit.entry, text: hit.text, cacheHit: true };
    }

    const { normalizedUrl, prefix, sharedKey } = this.keysFor(url, pdfUrl);
    const tenantKey = storage ? `${storage.describe()}::${sharedKey}` : null;

    const existingFlight = this.inFlight.get(sharedKey);
    if (existingFlight) {
      const artifact = await existingFlight;
      if (storage) {
        const persisted = await this.persistArtifactToStorage(storage, prefix, artifact.entry, {
          pngBytes: artifact.pngBytes,
          pdfBytes: artifact.pdfBytes,
          textBytes: artifact.textBytes,
        });
        this.setTenantIndex(tenantKey!, { entry: persisted, text: artifact.text });
        return { entry: persisted, text: artifact.text, cacheHit: true };
      }
      return { entry: artifact.entry, text: artifact.text, cacheHit: true };
    }

    const flight = (async (): Promise<SharedMemoryArtifact> => {
      const rendered = await this.render(url, pdfUrl, { semaphore: this.semaphore });
      const textBytes = rendered.readableText !== null ? Buffer.from(rendered.readableText, 'utf8') : undefined;
      const baseEntry: SourceCacheEntry = {
        url: rendered.url,
        normalizedUrl,
        finalUrl: rendered.finalUrl,
        contentType: rendered.contentType,
        ...(rendered.status !== undefined ? { status: rendered.status } : {}),
        capturedAt: rendered.capturedAt,
        ...(rendered.noReadableText ? { noReadableText: true as const } : {}),
        textCharCount: rendered.readableText?.length ?? 0,
        ...(rendered.pdfUrl ? { pdfUrl: rendered.pdfUrl } : {}),
      };

      const persisted = storage
        ? await this.persistArtifactToStorage(storage, prefix, baseEntry, {
            pngBytes: rendered.pngBytes,
            pdfBytes: rendered.pdfBytes,
            textBytes,
          })
        : baseEntry;

      if (tenantKey) {
        this.setTenantIndex(tenantKey, { entry: persisted, text: rendered.readableText });
      }

      const keepPdfInMem =
        rendered.pdfBytes && rendered.pdfBytes.byteLength <= MAX_IN_MEMORY_PDF_BYTES
          ? rendered.pdfBytes
          : undefined;
      const approxBytes =
        rendered.pngBytes.byteLength +
        (keepPdfInMem?.byteLength ?? 0) +
        (textBytes?.byteLength ?? 0) +
        1024;
      const artifact: SharedMemoryArtifact = {
        entry: persisted,
        text: rendered.readableText,
        pngBytes: rendered.pngBytes,
        pdfBytes: keepPdfInMem,
        textBytes,
        approxBytes,
      };
      this.setSharedArtifact(sharedKey, artifact);
      return artifact;
    })();

    this.inFlight.set(sharedKey, flight);
    try {
      const artifact = await flight;
      return { entry: artifact.entry, text: artifact.text, cacheHit: false };
    } finally {
      this.inFlight.delete(sharedKey);
    }
  }

  /**
   * Promote a cached artifact into immutable `evidence/` if present in cache
   * for the same day; returns `null` on a cache miss so `captureEvidence` can
   * perform a live render.
   */
  async promoteIfCached(
    storage: TenantStorage,
    url: string,
    pdfUrl?: string,
  ): Promise<CaptureResult | null> {
    await assertPublicHttpsUrl(url);
    if (pdfUrl) await assertPublicHttpsUrl(pdfUrl);
    const hit = await this.lookup(storage, url, pdfUrl);
    if (!hit) return null;
    if (!hit.entry.snapshotPath && !hit.inMemoryBytes?.pngBytes) return null;
    return promoteCachedEvidence(storage, hit.entry, { inMemoryBytes: hit.inMemoryBytes });
  }
}

let sharedSourceCache: SourceCache | null = null;

/** Process-wide shared `SourceCache` used by default across sessions and portrait runs. */
export function getSharedSourceCache(): SourceCache {
  sharedSourceCache ??= new SourceCache();
  return sharedSourceCache;
}

/** Reset the shared `SourceCache` (for isolated tests). */
export function resetSharedSourceCache(): void {
  sharedSourceCache?.clear();
  sharedSourceCache = null;
}

// ---------------------------------------------------------------------------
// Bounded excerpt builder for `mcp__evidence__read_source`
// ---------------------------------------------------------------------------

function truncateUtf8Safe(text: string, maxBytes: number): string {
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

function normalizePageRangeLocator(pageRange: string | undefined): string | undefined {
  if (!pageRange) return undefined;
  const trimmed = pageRange.trim();
  if (!trimmed) return undefined;
  return /^(?:pp?\.|pages?)\b/i.test(trimmed) ? trimmed : `pp. ${trimmed}`;
}

export interface ReadSourceExcerptResult {
  excerpt: string;
  truncated: boolean;
  pagesIncluded?: number[];
  totalPages?: number;
}

/**
 * Pure: extract a strictly byte-bounded excerpt from cached readable text for
 * `mcp__evidence__read_source(url, { query?, page_range? })`.
 *
 * - Multi-page PDFs (or any request specifying `page_range`) use
 *   `extractPageWindowExcerpt` from `text-extract.ts`.
 * - Single-page HTML/CSV/text documents return the full text when within
 *   `maxBytes`, or query-focused line windows when `query` is supplied and the
 *   document exceeds `maxBytes`.
 */
export function buildReadSourceExcerpt(
  fullText: string | null | undefined,
  opts: { url: string; query?: string; pageRange?: string; maxBytes?: number },
): ReadSourceExcerptResult {
  if (!fullText || !fullText.trim()) {
    return { excerpt: '', truncated: false };
  }
  const maxBytes = Math.max(1024, opts.maxBytes ?? DEFAULT_READ_SOURCE_MAX_BYTES);
  const pages = extractPdfTextPages(fullText);
  const locatorText = normalizePageRangeLocator(opts.pageRange);

  if (pages.length > 1 || (locatorText && pages.length >= 1)) {
    const queryStr = opts.query?.trim();
    const numericToken = queryStr ? /\d+(?:,\d{3})*(?:\.\d+)?%?/.exec(queryStr)?.[0] : undefined;
    const keywords = queryStr ? queryStr.split(/\s+/).filter((t) => t.length >= 2) : undefined;
    const res = extractPageWindowExcerpt(
      pages,
      {
        sourceUrl: opts.url,
        locatorText,
        claimedValue: numericToken,
        indicatorName: queryStr,
        keywords,
      },
      {
        maxBytes,
        windowRadius: locatorText ? 0 : 1,
        headerTitle: '[SOURCE EXCERPT — PLAYWRIGHT/PDF READER]',
        headerReason: 'Bounded excerpt from cached source text',
      },
    );
    return {
      excerpt: res.text,
      truncated: res.truncated || res.pagesIncluded.length < res.totalPages,
      pagesIncluded: res.pagesIncluded,
      totalPages: res.totalPages,
    };
  }

  const trimmed = (pages[0] ?? fullText).trim();
  if (Buffer.byteLength(trimmed, 'utf8') <= maxBytes) {
    return { excerpt: trimmed, truncated: false };
  }

  const truncationSuffix = '\n[...excerpt truncated at byte limit...]';
  const queryStr = opts.query?.trim();
  if (queryStr) {
    const terms = [...new Set((queryStr.toLowerCase().match(/[a-z0-9.%-]+/g) ?? []).filter((t) => t.length >= 2))];
    if (terms.length > 0) {
      const lines = trimmed.split('\n');
      const scored: Array<{ idx: number; score: number }> = [];
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i]!.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (lower.includes(term)) score += /\d/.test(term) ? 3 : 1;
        }
        if (score > 0) scored.push({ idx: i, score });
      }
      if (scored.length > 0) {
        scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
        const ranges: Array<[number, number]> = [];
        const addRange = (start: number, end: number) => {
          for (const existing of ranges) {
            if (start <= existing[1] + 1 && end >= existing[0] - 1) {
              existing[0] = Math.min(existing[0], start);
              existing[1] = Math.max(existing[1], end);
              return;
            }
          }
          ranges.push([start, end]);
        };
        for (const hit of scored.slice(0, 12)) {
          addRange(Math.max(0, hit.idx - 2), Math.min(lines.length - 1, hit.idx + 2));
        }
        ranges.sort((a, b) => a[0] - b[0]);

        const header = `[Matched excerpt for ${JSON.stringify(queryStr)} — full source ${trimmed.length} chars]\n\n`;
        const sep = '\n[...]\n';
        let budget = maxBytes - Buffer.byteLength(header, 'utf8') - Buffer.byteLength(truncationSuffix, 'utf8');
        const snippets: string[] = [];
        for (const [start, end] of ranges) {
          const block = lines.slice(start, end + 1).join('\n');
          const piece = (snippets.length ? sep : '') + block;
          const pieceBytes = Buffer.byteLength(piece, 'utf8');
          if (pieceBytes <= budget) {
            snippets.push(block);
            budget -= pieceBytes;
          } else if (budget > 64) {
            const prefix = snippets.length ? sep : '';
            const partial = truncateUtf8Safe(block, budget - Buffer.byteLength(prefix, 'utf8'));
            if (partial) snippets.push(partial);
            break;
          } else {
            break;
          }
        }
        if (snippets.length > 0) {
          const combined = `${header}${snippets.join(sep)}${truncationSuffix}`;
          const finalExcerpt =
            Buffer.byteLength(combined, 'utf8') <= maxBytes
              ? combined
              : truncateUtf8Safe(combined, maxBytes - Buffer.byteLength(truncationSuffix, 'utf8')) + truncationSuffix;
          return { excerpt: finalExcerpt, truncated: true };
        }
      }
    }
  }

  const available = Math.max(64, maxBytes - Buffer.byteLength(truncationSuffix, 'utf8'));
  return {
    excerpt: truncateUtf8Safe(trimmed, available) + truncationSuffix,
    truncated: true,
  };
}

export interface ReadSourceToolResult {
  url: string;
  final_url: string;
  content_type: string;
  text_char_count: number;
  excerpt: string;
  cache_hit: boolean;
  truncated: boolean;
  pages_included?: number[];
  total_pages?: number;
}

/**
 * Execute `mcp__evidence__read_source` against a `SourceCache` (and optional
 * `TenantStorage`), returning a strictly byte-bounded structured payload.
 */
export async function readSourceWithCache(
  cache: SourceCache,
  storage: TenantStorage | undefined,
  args: { url: string; query?: string; page_range?: string; maxBytes?: number },
): Promise<ReadSourceToolResult> {
  const fetched = await cache.getOrFetch(storage, args.url);
  const excerpted = buildReadSourceExcerpt(fetched.text, {
    url: args.url,
    query: args.query,
    pageRange: args.page_range,
    maxBytes: args.maxBytes,
  });
  return {
    url: args.url,
    final_url: fetched.entry.finalUrl,
    content_type: fetched.entry.contentType,
    text_char_count: fetched.entry.textCharCount,
    excerpt: excerpted.excerpt,
    cache_hit: fetched.cacheHit,
    truncated: excerpted.truncated,
    ...(excerpted.pagesIncluded ? { pages_included: excerpted.pagesIncluded } : {}),
    ...(excerpted.totalPages ? { total_pages: excerpted.totalPages } : {}),
  };
}
