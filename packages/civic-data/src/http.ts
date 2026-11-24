import { isIP } from 'node:net';
import {
  EgressBlockedError,
  assertPublicHttpsUrl,
  guardedFetch,
  isPrivateAddress,
} from '@deep-fryer/research';
import { CivicDataError, type CivicDataHttpOptions } from './types.js';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_USER_AGENT = 'deep-fryer-civic-data/1.0 (+https://open-doughnut.org)';

const SECRET_QUERY_PARAMS = new Set(['key', 'api_key', 'apikey', '$$app_token', 'token']);

/**
 * Strip API keys and tokens from a URL so archived provenance URLs and error
 * messages never leak credentials into tenant evidence storage or logs.
 */
export function redactUrlSecrets(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Synchronous structural egress check applied to EVERY request, including when
 * a custom `fetch` is injected in unit tests: HTTPS-only, no embedded
 * credentials, no localhost / local-only hostnames, and no private IP literals.
 */
export function validateHttpsUrlSync(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CivicDataError('EGRESS_BLOCKED', `egress blocked for ${rawUrl}: not a valid URL`, {
      url: rawUrl,
    });
  }
  const safeUrl = redactUrlSecrets(url.toString());
  if (url.protocol !== 'https:') {
    throw new CivicDataError('EGRESS_BLOCKED', `egress blocked for ${safeUrl}: only https is allowed`, {
      url: safeUrl,
    });
  }
  if (url.username || url.password) {
    throw new CivicDataError(
      'EGRESS_BLOCKED',
      `egress blocked for ${safeUrl}: credentials in URL are forbidden`,
      { url: safeUrl },
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new CivicDataError(
      'EGRESS_BLOCKED',
      `egress blocked for ${safeUrl}: local/internal hostname is forbidden`,
      { url: safeUrl },
    );
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new CivicDataError(
      'EGRESS_BLOCKED',
      `egress blocked for ${safeUrl}: resolves to non-public address ${host}`,
      { url: safeUrl },
    );
  }
  return url;
}

function isAbortOrTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'TimeoutError' || e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

async function readResponseTextBounded(
  res: Response,
  maxBytes: number,
  safeUrl: string,
): Promise<string> {
  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CivicDataError(
      'RESPONSE_TOO_LARGE',
      `response from ${safeUrl} exceeds ${maxBytes} bytes (${declaredLength} bytes declared)`,
      { status: res.status, url: safeUrl },
    );
  }

  if (!res.body) {
    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      throw new CivicDataError(
        'RESPONSE_TOO_LARGE',
        `response from ${safeUrl} exceeds ${maxBytes} bytes`,
        { status: res.status, url: safeUrl },
      );
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new CivicDataError(
            'RESPONSE_TOO_LARGE',
            `response from ${safeUrl} exceeds ${maxBytes} bytes`,
            { status: res.status, url: safeUrl },
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export interface JsonFetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface JsonFetchResponse<T = unknown> {
  status: number;
  data: T;
  rawText: string;
  canonicalUrl: string;
}

/**
 * Fetch and parse a JSON API response through the egress guard with strict
 * HTTPS validation, timeout enforcement, and a bounded response byte budget.
 */
export async function fetchCivicJson<T = unknown>(
  req: JsonFetchRequest,
  opts: CivicDataHttpOptions = {},
): Promise<JsonFetchResponse<T>> {
  const validated = validateHttpsUrlSync(req.url);
  const canonicalUrl = redactUrlSecrets(validated.toString());
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new CivicDataError('INVALID_INPUT', 'timeoutMs must be a positive number', {
      url: canonicalUrl,
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
    ...req.headers,
  };

  const signal = AbortSignal.timeout(timeoutMs);
  const init: RequestInit = {
    method: req.method ?? 'GET',
    headers,
    body: req.body,
    signal,
  };

  let res: Response;
  try {
    if (opts.fetch) {
      if (opts.resolve) {
        await assertPublicHttpsUrl(validated.toString(), opts.resolve);
      }
      res = await opts.fetch(validated.toString(), init);
    } else {
      res = await guardedFetch(validated.toString(), init, opts.resolve);
    }
  } catch (err) {
    if (err instanceof CivicDataError) throw err;
    if (err instanceof EgressBlockedError) {
      throw new CivicDataError('EGRESS_BLOCKED', err.message, { url: canonicalUrl, cause: err });
    }
    if (isAbortOrTimeoutError(err)) {
      throw new CivicDataError(
        'TIMEOUT',
        `request to ${canonicalUrl} timed out after ${timeoutMs}ms`,
        { url: canonicalUrl, cause: err },
      );
    }
    throw new CivicDataError(
      'HTTP_ERROR',
      `request to ${canonicalUrl} failed: ${err instanceof Error ? err.message : String(err)}`,
      { url: canonicalUrl, cause: err },
    );
  }

  let rawText: string;
  try {
    rawText = await readResponseTextBounded(res, maxBytes, canonicalUrl);
  } catch (err) {
    if (err instanceof CivicDataError) throw err;
    if (isAbortOrTimeoutError(err)) {
      throw new CivicDataError(
        'TIMEOUT',
        `reading response from ${canonicalUrl} timed out after ${timeoutMs}ms`,
        { status: res.status, url: canonicalUrl, cause: err },
      );
    }
    throw new CivicDataError(
      'HTTP_ERROR',
      `failed to read response body from ${canonicalUrl}: ${err instanceof Error ? err.message : String(err)}`,
      { status: res.status, url: canonicalUrl, cause: err },
    );
  }

  if (!res.ok) {
    const snippet = rawText.trim().slice(0, 300);
    throw new CivicDataError(
      'HTTP_ERROR',
      `upstream API returned HTTP ${res.status} for ${canonicalUrl}${snippet ? `: ${snippet}` : ''}`,
      { status: res.status, url: canonicalUrl },
    );
  }

  if (res.status === 204 || rawText.trim() === '') {
    throw new CivicDataError(
      'PARSE_ERROR',
      `upstream API returned an empty body (HTTP ${res.status}) for ${canonicalUrl}`,
      { status: res.status, url: canonicalUrl },
    );
  }

  let data: T;
  try {
    data = JSON.parse(rawText) as T;
  } catch (err) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `invalid JSON response from ${canonicalUrl}: ${err instanceof Error ? err.message : String(err)}`,
      { status: res.status, url: canonicalUrl, cause: err },
    );
  }

  return {
    status: res.status,
    data,
    rawText,
    canonicalUrl,
  };
}
