import { describe, expect, it } from 'vitest';
import { fetchCivicJson, redactUrlSecrets, validateHttpsUrlSync } from './http.js';
import { CivicDataError, type FetchFn } from './types.js';

describe('http egress boundary', () => {
  it('redacts sensitive query parameters without altering non-secret params', () => {
    const raw =
      'https://api.census.gov/data/2023/acs/acs5?get=NAME,B17001_002E&for=county:087&in=state:06&key=SECRET_KEY_123';
    const redacted = redactUrlSecrets(raw);
    expect(redacted).not.toContain('SECRET_KEY_123');
    expect(redacted).not.toContain('key=');
    expect(redacted).toContain('get=NAME%2CB17001_002E');
    expect(redacted).toContain('for=county%3A087');
  });

  it('refuses non-HTTPS URLs, credentials in URL, localhost, and private IP literals', () => {
    const blocked = [
      'http://api.census.gov/data/2023/acs/acs5',
      'file:///etc/passwd',
      'ftp://api.census.gov/data',
      'https://user:pass@api.census.gov/data',
      'https://localhost/api',
      'https://metadata.internal/latest',
      'https://127.0.0.1/api',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/api',
      'https://[::1]/api',
      'not-a-url',
    ];
    for (const url of blocked) {
      expect(() => validateHttpsUrlSync(url)).toThrow(CivicDataError);
      try {
        validateHttpsUrlSync(url);
      } catch (err) {
        expect((err as CivicDataError).code).toBe('EGRESS_BLOCKED');
      }
    }
  });

  it('enforces DNS resolution check when custom resolver returns a private address', async () => {
    const mockFetch: FetchFn = async () => {
      throw new Error('fetch must not be called when egress is blocked');
    };
    await expect(
      fetchCivicJson(
        { url: 'https://api.census.gov/data/2023/acs/acs5' },
        {
          fetch: mockFetch,
          resolve: async () => ['169.254.169.254'],
        },
      ),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' });
  });

  it('classifies request timeouts as CivicDataError(TIMEOUT)', async () => {
    const mockFetch: FetchFn = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    await expect(
      fetchCivicJson(
        { url: 'https://api.census.gov/data/2023/acs/acs5?key=TOPSECRET' },
        { fetch: mockFetch, timeoutMs: 500 },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(CivicDataError);
      const e = err as CivicDataError;
      expect(e.code).toBe('TIMEOUT');
      expect(e.message).not.toContain('TOPSECRET');
      return true;
    });
  });

  it('redacts API keys on HTTP errors and surfaces status codes', async () => {
    const mockFetch: FetchFn = async () => new Response('Rate limit exceeded', { status: 429 });
    await expect(
      fetchCivicJson(
        { url: 'https://api.census.gov/data/2023/acs/acs5?key=SUPERSECRET' },
        { fetch: mockFetch },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as CivicDataError;
      expect(e.code).toBe('HTTP_ERROR');
      expect(e.status).toBe(429);
      expect(e.message).not.toContain('SUPERSECRET');
      expect(e.url).not.toContain('SUPERSECRET');
      return true;
    });
  });

  it('rejects malformed JSON and oversized response payloads', async () => {
    const badJsonFetch: FetchFn = async () => new Response('<html>oops</html>', { status: 200 });
    await expect(
      fetchCivicJson({ url: 'https://data.cdc.gov/resource/swc5-untb.json' }, { fetch: badJsonFetch }),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });

    const bigFetch: FetchFn = async () =>
      new Response(JSON.stringify({ data: 'x'.repeat(2048) }), { status: 200 });
    await expect(
      fetchCivicJson(
        { url: 'https://data.cdc.gov/resource/swc5-untb.json' },
        { fetch: bigFetch, maxResponseBytes: 512 },
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});
