import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHttpsUrl, guardedFetch, isPrivateAddress } from './egress.js';

const resolveTo = (map: Record<string, string[]>) => async (host: string) => map[host] ?? [];

describe('isPrivateAddress', () => {
  it('flags loopback, RFC1918, link-local/metadata, CGNAT, and IPv6 private ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('checks the embedded IPv4 address in every mapped IPv6 representation', () => {
    for (const ipv4 of [
      '0.0.0.1', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
      '172.16.0.9', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
      '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    ]) {
      const octets = ipv4.split('.').map(Number);
      const high = (octets[0]! * 256 + octets[1]!).toString(16);
      const low = (octets[2]! * 256 + octets[3]!).toString(16);
      for (const ip of [
        `::ffff:${ipv4}`, `::ffff:${high}:${low}`, `0:0:0:0:0:ffff:${ipv4}`,
        `0000:0000:0000:0000:0000:FFFF:${high.padStart(4, '0')}:${low.padStart(4, '0')}`,
        `0:0::ffff:${high}:${low}`,
      ]) {
        expect(isPrivateAddress(ip), ip).toBe(true);
      }
    }
  });
  it('recognizes expanded unspecified and loopback IPv6 addresses', () => {
    for (const ip of ['0:0:0:0:0:0:0:0', '0:0:0:0:0:0:0:1', '0::1', '::0001']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('passes public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '151.101.1.69', '2606:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '0:0:0:0:0:ffff:0808:0808']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertPublicHttpsUrl', () => {
  it.each([
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[0:0:0:0:0:ffff:a9fe:a9fe]/latest/meta-data/',
    'https://[::ffff:c0a8:101]/',
  ])('rejects mapped private literals after URL normalization: %s', async (url) => {
    const resolve = vi.fn(async () => ['8.8.8.8']);
    await expect(assertPublicHttpsUrl(url, resolve)).rejects.toThrow(/non-public/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a DNS answer with a mapped private address alongside public answers', async () => {
    await expect(assertPublicHttpsUrl('https://mixed.example/', resolveTo({
      'mixed.example': ['8.8.8.8', '0:0:0:0:0:ffff:7f00:1'],
    }))).rejects.toThrow(/non-public/);
  });

  it('requires https and public resolution', async () => {
    await expect(assertPublicHttpsUrl('http://data.cityofnewyork.us/x', resolveTo({}))).rejects.toThrow(/only https/);
    await expect(
      assertPublicHttpsUrl('https://metadata.internal/latest', resolveTo({ 'metadata.internal': ['169.254.169.254'] })),
    ).rejects.toThrow(/non-public address 169.254.169.254/);
    await expect(assertPublicHttpsUrl('https://127.0.0.1/', resolveTo({}))).rejects.toThrow(/non-public/);
    await expect(assertPublicHttpsUrl('https://user:pw@example.gov/', resolveTo({}))).rejects.toThrow(/credentials/);
    // Any private answer poisons the host (DNS can return several).
    await expect(
      assertPublicHttpsUrl('https://mixed.example/', resolveTo({ 'mixed.example': ['8.8.8.8', '10.0.0.5'] })),
    ).rejects.toThrow(/non-public/);
    const ok = await assertPublicHttpsUrl('https://www.nyc.gov/site/x', resolveTo({ 'www.nyc.gov': ['23.1.2.3'] }));
    expect(ok.hostname).toBe('www.nyc.gov');
  });
});

describe('guardedFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('re-checks every redirect hop', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://public.example/start'
        ? new Response(null, { status: 302, headers: { location: 'https://internal.example/admin' } })
        : new Response('secret', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      guardedFetch('https://public.example/start', {}, resolveTo({ 'public.example': ['8.8.8.8'], 'internal.example': ['10.0.0.7'] })),
    ).rejects.toThrow(/non-public address 10.0.0.7/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to mapped IPv4 metadata before making a second request', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://[::ffff:169.254.169.254]/latest/meta-data/' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(guardedFetch('https://public.example/start', {}, resolveTo({
      'public.example': ['8.8.8.8'],
    }))).rejects.toThrow(/non-public/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects to the final response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/a')
          ? new Response(null, { status: 301, headers: { location: '/b' } })
          : new Response('ok', { status: 200 }),
      ),
    );
    const res = await guardedFetch('https://public.example/a', {}, resolveTo({ 'public.example': ['8.8.8.8'] }));
    expect(await res.text()).toBe('ok');
  });
});
