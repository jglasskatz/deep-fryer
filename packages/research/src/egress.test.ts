import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EgressBlockedError,
  assertPublicHttpsUrl,
  createPinnedLookup,
  guardedFetch,
  hasEgressProxy,
  isPrivateAddress,
  pinnedHttpsRequest,
  validateAddress,
  type GuardedFetchOptions,
} from './egress.js';

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

describe('isPrivateAddress: IPv6 forms that carry or name a non-public address', () => {
  // Non-public IPv4 targets an attacker would aim for, and public ones that must pass.
  const privateV4 = ['127.0.0.1', '10.0.0.1', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'];
  const publicV4 = ['8.8.8.8', '151.101.1.69', '23.1.2.3'];
  const hex = (ipv4: string) => {
    const o = ipv4.split('.').map(Number);
    return [((o[0]! << 8) | o[1]!).toString(16), ((o[2]! << 8) | o[3]!).toString(16)] as const;
  };
  const pad = (word: string) => word.padStart(4, '0');

  /** Every spelling of the same embedded IPv4 address within each embedding range. */
  function spellings(ipv4: string): string[] {
    const [hi, lo] = hex(ipv4);
    return [
      // IPv4-mapped ::ffff:0:0/96
      `::ffff:${ipv4}`, `::ffff:${hi}:${lo}`, `::FFFF:${hi.toUpperCase()}:${lo.toUpperCase()}`,
      `0000:0000:0000:0000:0000:ffff:${pad(hi)}:${pad(lo)}`, `0:0:0:0:0:ffff:${ipv4}`,
      // IPv4-compatible ::/96
      `::${ipv4}`, `::${hi}:${lo}`, `0:0:0:0:0:0:${hi}:${lo}`, `0000:0000:0000:0000:0000:0000:${pad(hi)}:${pad(lo)}`,
      // IPv4-translated ::ffff:0:0:0/96
      `::ffff:0:${ipv4}`, `::ffff:0:${hi}:${lo}`, `0:0:0:0:ffff:0:${hi}:${lo}`,
      // NAT64 well-known prefix 64:ff9b::/96
      `64:ff9b::${ipv4}`, `64:ff9b::${hi}:${lo}`, `64:FF9B::${hi.toUpperCase()}:${lo.toUpperCase()}`,
      `0064:ff9b:0000:0000:0000:0000:${pad(hi)}:${pad(lo)}`, `64:ff9b:0:0:0:0:${ipv4}`,
      // 6to4 2002::/16, IPv4 in the second and third words, any suffix
      `2002:${hi}:${lo}::`, `2002:${hi}:${lo}::1`, `2002:${pad(hi)}:${pad(lo)}:0:0:0:0:0`,
      `2002:${hi.toUpperCase()}:${lo.toUpperCase()}:abcd::1234`,
    ];
  }

  it('meets the named cases', () => {
    for (const ip of ['64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '::7f00:1', '2002:7f00:1::', '::ffff:0:127.0.0.1', 'fec0::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('64:ff9b::808:808')).toBe(false);
  });

  it('refuses a private IPv4 address embedded in any form', () => {
    for (const ipv4 of privateV4) {
      for (const ip of spellings(ipv4)) expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows a public IPv4 address embedded in the same forms', () => {
    for (const ipv4 of publicV4) {
      for (const ip of spellings(ipv4)) expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses unique-local, link-local, site-local, multicast and reserved ranges in any spelling', () => {
    for (const ip of [
      '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::', '[::1]',
      'fc00::1', 'FD12:3456:789A::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe80::1', 'FE80::1', 'fe80:0000:0000:0000:0000:0000:0000:0001', 'febf::1',
      'fe80::1%eth0', 'fe80::1%25en0', 'FE80::A9FE:A9FE%lo0', '[fe80::1]',
      'fec0::1', 'FEC0:0:0:0:0:0:0:1', 'feff::1',
      'ff02::1', 'FF05::2',
      '64:ff9b:1::7f00:1', '64:ff9b:1::808:808', '64:ff9b:1:ffff::1',
      '100::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:2::1', '2001:db8::1', 'fd00:ec2::254',
      '3fff::1', '5f00::1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows ordinary global IPv6 addresses', () => {
    for (const ip of [
      '2606:4700::1111', '2606:4700:4700::1111', '2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888',
      '2620:fe::fe', '2A00:1450:4001:82B::200E', '[2606:4700::1111]', '2600:1f18::1',
      '2003::1', '2001:200::1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses strings that are not an address', () => {
    for (const ip of ['', 'localhost', '::ffff:999.0.0.1', '1::2::3', '12345::1', '[::1', 'fe80::1%']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
});

describe('assertPublicHttpsUrl: address literals in URLs', () => {
  it.each([
    'https://[64:ff9b::7f00:1]/',
    'https://[64:ff9b::169.254.169.254]/latest/meta-data/',
    'https://[::127.0.0.1]/',
    'https://[0:0:0:0:0:0:7f00:1]/',
    'https://[2002:a9fe:a9fe::]/latest/meta-data/',
    'https://[::ffff:0:10.0.0.1]/',
    'https://[FEC0::1]/',
    'https://[fd00:ec2::254]/',
    'https://[FE80::1]/',
    'https://0x7f.1/',
    'https://2130706433/',
    'https://0251.0376.0251.0376/',
  ])('rejects %s without resolving it', async (url) => {
    const resolve = vi.fn(async () => ['8.8.8.8']);
    await expect(assertPublicHttpsUrl(url, resolve)).rejects.toThrow(/non-public/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a link-local literal with a zone id', async () => {
    await expect(assertPublicHttpsUrl('https://[fe80::1%25eth0]/', async () => ['8.8.8.8'])).rejects.toThrow(EgressBlockedError);
  });

  it('rejects a host whose DNS answer is a private address written as NAT64 or 6to4', async () => {
    for (const answer of ['64:ff9b::a9fe:a9fe', '2002:c0a8:101::1', 'fe80::1%en0', 'fec0::1']) {
      await expect(
        assertPublicHttpsUrl('https://sneaky.example/', resolveTo({ 'sneaky.example': ['2606:4700::1111', answer] })),
        answer,
      ).rejects.toThrow(/non-public/);
    }
  });

  it('allows public literals in the embedding forms', async () => {
    for (const url of ['https://[64:ff9b::8.8.8.8]/', 'https://[2002:808:808::1]/', 'https://[2606:4700::1111]/']) {
      const ok = await assertPublicHttpsUrl(url, async () => []);
      expect(ok.protocol, url).toBe('https:');
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

  it('pins the verified public IP from a single DNS lookup so DNS rebinding cannot reach a private IP', async () => {
    // Attacker's TTL=0 DNS returns a public IP on first query and cloud metadata on second.
    let calls = 0;
    const rebindingResolve = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? ['93.184.216.34'] : ['169.254.169.254'];
    });

    const resolvedFromPinned: Array<{ address: string | LookupAddress[]; family?: number }> = [];
    const transport = vi.fn<NonNullable<GuardedFetchOptions['pinnedTransport']>>(async (validated, _init, pinnedLookup) => {
      expect(validated.host).toBe('rebind.example.gov');
      expect(validated.addresses).toEqual(['93.184.216.34']);

      // Simulate undici / net.connect invoking the custom lookup callback twice (single & all).
      await new Promise<void>((resolve, reject) => {
        pinnedLookup('rebind.example.gov', {}, (err, address, family) => {
          if (err) return reject(err);
          resolvedFromPinned.push({ address, family });
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        pinnedLookup('rebind.example.gov', { all: true }, (err, addresses) => {
          if (err) return reject(err);
          resolvedFromPinned.push({ address: addresses });
          resolve();
        });
      });

      return new Response('verified public body', { status: 200 });
    });

    const res = await guardedFetch(
      'https://rebind.example.gov/report.pdf',
      {},
      rebindingResolve,
      { proxyUrl: null, pinnedTransport: transport },
    );
    expect(await res.text()).toBe('verified public body');
    // DNS was queried strictly once — the pinned callback never triggers a second lookup.
    expect(rebindingResolve).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(resolvedFromPinned).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: [{ address: '93.184.216.34', family: 4 }] },
    ]);
  });

  it('re-validates DNS on redirect hops and refuses if the host re-binds to a private IP', async () => {
    let calls = 0;
    const rebindingResolve = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? ['93.184.216.34'] : ['169.254.169.254'];
    });
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/next' } }));

    await expect(
      guardedFetch('https://rebind.example.gov/start', {}, rebindingResolve, {
        proxyUrl: null,
        pinnedTransport: transport,
      }),
    ).rejects.toThrow(/non-public address 169\.254\.169\.254/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(rebindingResolve).toHaveBeenCalledTimes(2);
  });

  it('delegates to fetch when WORKER_HTTPS_PROXY is active', async () => {
    const injectedFetch = vi.fn(async () => new Response('via-proxy', { status: 200 }));
    const res = await guardedFetch(
      'https://public.example/data',
      {},
      resolveTo({ 'public.example': ['8.8.8.8'] }),
      { proxyUrl: 'http://egress-proxy:3128', fetch: injectedFetch },
    );
    expect(await res.text()).toBe('via-proxy');
    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(hasEgressProxy({ WORKER_HTTPS_PROXY: 'http://egress:3128' })).toBe(true);
    expect(hasEgressProxy({})).toBe(false);
  });
});

describe('createPinnedLookup & pinnedHttpsRequest', () => {
  it('returns pinned IPv4/IPv6 addresses, respects family filter, and refuses mismatches or private IPs', async () => {
    expect(() => createPinnedLookup('example.gov', [])).toThrow(EgressBlockedError);
    expect(() => createPinnedLookup('example.gov', ['127.0.0.1'])).toThrow(/non-public/);
    expect(() => createPinnedLookup('example.gov', ['8.8.8.8', '::ffff:10.0.0.1'])).toThrow(/non-public/);

    const lookupFn = createPinnedLookup('Data.Example.Gov', ['8.8.8.8', '2606:4700::1111']);

    const v4 = await new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
      lookupFn('data.example.gov', { family: 4 }, (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      );
    });
    expect(v4).toEqual({ address: '8.8.8.8', family: 4 });

    const v6 = await new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
      lookupFn('data.example.gov', { family: 6 }, (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      );
    });
    expect(v6).toEqual({ address: '2606:4700::1111', family: 6 });

    const all = await new Promise<LookupAddress[]>((resolve, reject) => {
      lookupFn('data.example.gov', { all: true }, (err, addresses) =>
        err ? reject(err) : resolve(addresses as LookupAddress[]),
      );
    });
    expect(all).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);

    // Refuses any hostname other than the validated one.
    await expect(
      new Promise((resolve, reject) => {
        lookupFn('evil.internal', {}, (err, address) => (err ? reject(err) : resolve(address)));
      }),
    ).rejects.toThrow(/unexpected host evil\.internal/);

    // Returns ENOTFOUND when requested address family is absent.
    const v4Only = createPinnedLookup('v4.example.gov', ['8.8.8.8']);
    await expect(
      new Promise((resolve, reject) => {
        v4Only('v4.example.gov', { family: 6 }, (err, address) => (err ? reject(err) : resolve(address)));
      }),
    ).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });

  it('preserves TLS SNI (servername), disables connection pooling, and streams the Web Response', async () => {
    const validated = await validateAddress(
      'https://data.example.gov/api/report.pdf?year=2025',
      resolveTo({ 'data.example.gov': ['93.184.216.34'] }),
    );
    const pinnedLookup = createPinnedLookup(validated.host, validated.addresses);
    let capturedUrl: URL | undefined;
    let capturedOpts: HttpsRequestOptions | undefined;

    const fakeRequest = (url: URL, options: HttpsRequestOptions, cb: (res: IncomingMessage) => void): ClientRequest => {
      capturedUrl = url;
      capturedOpts = options;
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          const stream = Readable.from([Buffer.from('PDF-bytes-123')]) as unknown as IncomingMessage;
          stream.statusCode = 200;
          stream.statusMessage = 'OK';
          stream.headers = { 'content-type': 'application/pdf' };
          cb(stream);
        },
      }) as unknown as ClientRequest;
      return req;
    };

    const res = await pinnedHttpsRequest(
      validated,
      { method: 'GET', headers: { accept: 'application/pdf' } },
      pinnedLookup,
      fakeRequest,
    );
    expect(capturedUrl?.href).toBe('https://data.example.gov/api/report.pdf?year=2025');
    expect(capturedOpts?.servername).toBe('data.example.gov');
    expect(capturedOpts?.lookup).toBe(pinnedLookup);
    expect(capturedOpts?.agent).toBe(false);
    expect(capturedOpts?.headers).toEqual({ accept: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('PDF-bytes-123');
  });
});
