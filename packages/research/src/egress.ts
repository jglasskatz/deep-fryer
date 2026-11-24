import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupOneOptions, LookupAllOptions } from 'node:dns';
import https, { type RequestOptions as HttpsRequestOptions } from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { matchBlockedSource, type SourceBlocklist } from './source-blocklist.js';

const activeEgressBlocklist = new AsyncLocalStorage<SourceBlocklist | undefined>();

/**
 * Return the ambient egress `SourceBlocklist` active in the current async
 * execution context (set via `withEgressBlocklist`), if any.
 */
export function getActiveEgressBlocklist(): SourceBlocklist | undefined {
  return activeEgressBlocklist.getStore();
}

/**
 * Run `fn` with `blocklist` enforced automatically on every `guardedFetch`,
 * `assertPublicHttpsUrl`, and `validateAddress` call inside its async tree
 * (including `read_source`, `capture_evidence`, `@deep-fryer/civic-data`, and
 * verifier URL checks).
 */
export function withEgressBlocklist<T>(blocklist: SourceBlocklist | undefined, fn: () => T): T {
  return activeEgressBlocklist.run(blocklist, fn);
}

/**
 * Worker egress guard (SPEC-v3 §2.3). Research agents choose the URLs the
 * worker fetches (source checks, evidence capture, read_source), so every
 * fetch is treated as attacker-influenced: https only, and the host must
 * resolve exclusively to public addresses — never loopback, RFC 1918,
 * link-local (cloud metadata at 169.254.169.254), CGNAT, or the IPv6
 * equivalents. Redirects are followed by hand so every hop is re-checked.
 *
 * When no allowlist proxy (`WORKER_HTTPS_PROXY` / `HTTPS_PROXY`) is set,
 * `guardedFetch` closes the DNS-rebinding TOCTOU gap by resolving DNS once
 * in `validateAddress` and pinning the verified public IP(s) via a custom
 * lookup callback (`createPinnedLookup`), preserving TLS SNI and the `Host`
 * header for HTTPS while preventing any second OS DNS lookup on the hop.
 */

const NATIVE_FETCH = globalThis.fetch;

export class EgressBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`egress blocked for ${url}: ${reason}`);
    this.name = 'EgressBlockedError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPrivateV4(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

const V4_DOTTED = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const V6_WORD = /^[0-9a-f]{1,4}$/i;

/**
 * Parse an IPv6 address into one 128-bit number, or null if it is not one.
 * Every textual form collapses to the same number: upper or lower case,
 * leading zeros, "::" compression, a dotted IPv4 tail, a zone id, brackets.
 */
function parseIPv6(raw: string): bigint | null {
  // A zone id ("%eth0") picks an interface; it does not change the address.
  let address = raw.split('%')[0]!;
  const words: number[] = [];
  const tailWords: number[] = [];
  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) return null;
  const last = address.slice(lastColon + 1);
  if (last.includes('.')) {
    if (!V4_DOTTED.test(last)) return null;
    const v4 = ipv4ToInt(last);
    tailWords.push(v4 >>> 16, v4 & 0xffff);
    // Keep a trailing "::" intact when the IPv4 part directly follows it.
    address = address.slice(0, address.endsWith(`::${last}`) ? lastColon + 1 : lastColon);
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((group) => V6_WORD.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const left = parse(halves[0]!);
  if (!left) return null;
  if (halves.length === 1) {
    words.push(...left, ...tailWords);
    if (words.length !== 8) return null;
  } else {
    const right = parse(halves[1]!);
    if (!right) return null;
    const known = left.length + right.length + tailWords.length;
    if (known > 7) return null;
    words.push(...left, ...Array<number>(8 - known).fill(0), ...right, ...tailWords);
  }
  return words.reduce((acc, word) => (acc << 16n) | BigInt(word), 0n);
}

function prefix(text: string, bits: number): [bigint, bigint] {
  const base = parseIPv6(text);
  if (base === null) throw new Error(`bad IPv6 prefix ${text}`);
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return [base & mask, mask];
}

const inPrefix = (n: bigint, [base, mask]: [bigint, bigint]) => (n & mask) === base;

/**
 * IPv6 ranges that carry an IPv4 address inside them. A packet to one of
 * these can end up at that IPv4 address (through a NAT64 gateway, a 6to4
 * relay, a dual-stack socket or a translator), so the embedded address
 * decides. `shift` is how far the 32-bit IPv4 address sits from the low end.
 */
const V6_EMBEDDING: { range: [bigint, bigint]; shift: bigint }[] = [
  { range: prefix('::', 96), shift: 0n }, // IPv4-compatible (deprecated), also covers :: and ::1
  { range: prefix('::ffff:0:0', 96), shift: 0n }, // IPv4-mapped
  { range: prefix('::ffff:0:0:0', 96), shift: 0n }, // IPv4-translated (SIIT)
  { range: prefix('64:ff9b::', 96), shift: 0n }, // well-known NAT64 prefix
  { range: prefix('2002::', 16), shift: 80n }, // 6to4: IPv4 in bits 16-47
];

/** IPv6 ranges that are never a public web host, refused outright. */
const V6_BLOCKS: [bigint, bigint][] = [
  prefix('64:ff9b:1::', 48), // local-use NAT64; the operator picks where IPv4 sits
  prefix('100::', 64), // discard-only
  prefix('2001::', 23), // IETF protocol assignments, including Teredo 2001::/32
  prefix('2001:db8::', 32), // documentation
  prefix('3fff::', 20), // documentation
  prefix('5f00::', 16), // SRv6 segment identifiers
  prefix('fc00::', 7), // unique-local
  prefix('fe80::', 10), // link-local
  prefix('fec0::', 10), // site-local (deprecated, still routed internally by some networks)
  prefix('ff00::', 8), // multicast
];

export function isPrivateAddress(ip: string): boolean {
  const host = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const family = isIP(host);
  if (family === 4) return isPrivateV4(ipv4ToInt(host));
  if (family === 6) {
    const n = parseIPv6(host);
    if (n === null) return true; // Node accepted it but we cannot read it: refuse
    const embedding = V6_EMBEDDING.find(({ range }) => inPrefix(n, range));
    if (embedding) return isPrivateV4(Number((n >> embedding.shift) & 0xffffffffn));
    return V6_BLOCKS.some((range) => inPrefix(n, range));
  }
  return true; // not an IP at all — refuse rather than guess
}

export interface ValidatedUrl {
  url: URL;
  /** Hostname without IPv6 brackets, as resolved and used for TLS SNI. */
  host: string;
  /** Verified public IPv4/IPv6 addresses resolved once for this hop. */
  addresses: string[];
}

/**
 * Validate `raw` is an https URL without embedded credentials whose host
 * resolves exclusively to public IP addresses and does not match any active
 * `SourceBlocklist`. Returns the parsed URL and its verified public IP(s) so
 * callers can pin the connection without a second DNS lookup.
 */
export async function validateAddress(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
  blocklist?: SourceBlocklist,
): Promise<ValidatedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressBlockedError(raw, 'not a URL');
  }
  const effectiveBlocklist = blocklist ?? getActiveEgressBlocklist();
  if (effectiveBlocklist) {
    const blocked = matchBlockedSource(raw, effectiveBlocklist);
    if (blocked) {
      throw new EgressBlockedError(raw, `blocked benchmark answer-key source: ${blocked.reason}`);
    }
  }
  if (url.protocol !== 'https:') throw new EgressBlockedError(raw, 'only https is allowed');
  if (url.username || url.password) throw new EgressBlockedError(raw, 'credentials in URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new EgressBlockedError(raw, 'host does not resolve');
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new EgressBlockedError(raw, `resolves to non-public address ${bad}`);
  return { url, host, addresses };
}

/** Throws EgressBlockedError unless `raw` is an https URL whose host resolves only to public IPs and is not blocked. */
export async function assertPublicHttpsUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
  blocklist?: SourceBlocklist,
): Promise<URL> {
  const { url } = await validateAddress(raw, resolve, blocklist);
  return url;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * Callback signature accepted by both `undici`'s `Agent({ connect: { lookup } })`
 * and Node's `net.connect` / `tls.connect` / `https.request({ lookup })`.
 */
export type PinnedLookup = LookupFunction;

/**
 * Build a DNS lookup callback pinned to the exact public IP(s) already verified
 * for `expectedHost`. Never performs a second OS DNS query, refuses any
 * hostname mismatch, and defense-in-depth refuses any non-public address.
 */
export function createPinnedLookup(expectedHost: string, addresses: readonly string[]): PinnedLookup {
  const normalizedExpected = expectedHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalizedExpected || addresses.length === 0) {
    throw new EgressBlockedError(expectedHost || '(empty)', 'no verified public addresses to pin');
  }
  const records: LookupAddress[] = addresses.map((raw) => {
    const addr = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
    const family = isIP(addr);
    if ((family !== 4 && family !== 6) || isPrivateAddress(addr)) {
      throw new EgressBlockedError(expectedHost, `refusing to pin non-public address ${raw}`);
    }
    return { address: addr, family };
  });

  const pinnedLookup = (
    hostname: string,
    optionsOrCb: LookupOneOptions | LookupAllOptions | number | ((err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void),
    maybeCb?: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb!;
    const opts =
      typeof optionsOrCb === 'number'
        ? { family: optionsOrCb }
        : typeof optionsOrCb === 'object' && optionsOrCb !== null
          ? optionsOrCb
          : {};

    const requested = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (requested !== normalizedExpected) {
      const err = new EgressBlockedError(
        hostname,
        `pinned lookup refused unexpected host ${hostname} (expected ${normalizedExpected})`,
      ) as NodeJS.ErrnoException;
      cb(err, '', 0);
      return;
    }

    const family = opts.family === 4 || opts.family === 6 ? opts.family : undefined;
    const matched = family ? records.filter((r) => r.family === family) : records;
    if (matched.length === 0) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname} (no pinned IPv${family} address)`) as NodeJS.ErrnoException;
      err.code = 'ENOTFOUND';
      cb(err, '', 0);
      return;
    }

    if ('all' in opts && opts.all) {
      cb(
        null,
        matched.map((r) => ({ address: r.address, family: r.family })),
      );
      return;
    }

    const first = matched[0]!;
    cb(null, first.address, first.family);
  };

  return pinnedLookup as PinnedLookup;
}

/** Whether an explicit worker/env HTTPS proxy is configured (which pins egress at the proxy layer). */
export function hasEgressProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WORKER_HTTPS_PROXY || env.HTTPS_PROXY || env.https_proxy);
}

type UndiciAgentCtor = new (opts: { connect: { lookup: PinnedLookup } }) => {
  close?: () => Promise<void>;
  destroy?: () => Promise<void>;
};

let cachedUndiciAgent: Promise<UndiciAgentCtor | null> | null = null;

function loadUndiciAgent(): Promise<UndiciAgentCtor | null> {
  cachedUndiciAgent ??= (async () => {
    try {
      const modName = 'undici';
      const mod = (await import(modName)) as { Agent?: UndiciAgentCtor };
      return typeof mod.Agent === 'function' ? mod.Agent : null;
    } catch {
      return null;
    }
  })();
  return cachedUndiciAgent;
}

function normalizeHeaders(headersInit?: RequestInit['headers']): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headersInit) return out;
  const h = new Headers(headersInit);
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function normalizeRequestBody(body: RequestInit['body']): Promise<Buffer | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  if (typeof Blob !== 'undefined' && body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error('unsupported request body type for pinned HTTPS request');
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Perform a single HTTPS hop with `lookup` pinned to the verified public IP(s).
 * Preserves TLS SNI (`servername`) and the `Host` header, never reuses pooled
 * sockets across hops (`agent: false`), and returns a standard Web `Response`.
 */
export async function pinnedHttpsRequest(
  validated: ValidatedUrl,
  init: RequestInit,
  pinnedLookup: PinnedLookup,
  requestFn: (url: URL, options: HttpsRequestOptions, cb: (res: IncomingMessage) => void) => ClientRequest = https.request,
): Promise<Response> {
  const bodyBuf = await normalizeRequestBody(init.body);
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = normalizeHeaders(init.headers);

  return new Promise<Response>((resolveResponse, rejectResponse) => {
    const reqOptions: HttpsRequestOptions = {
      method,
      headers,
      signal: init.signal ?? undefined,
      lookup: pinnedLookup,
      servername: isIP(validated.host) ? undefined : validated.host,
      agent: false,
    };

    const req = requestFn(validated.url, reqOptions, (res) => {
      const status = res.statusCode ?? 200;
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) responseHeaders.append(key, v);
        } else {
          responseHeaders.set(key, value);
        }
      }

      const isRedirect = status >= 300 && status < 400 && responseHeaders.has('location');
      if (method === 'HEAD' || NULL_BODY_STATUSES.has(status) || isRedirect) {
        res.resume();
        resolveResponse(new Response(null, { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
        return;
      }

      const webStream = Readable.toWeb(res) as ReadableStream<Uint8Array>;
      resolveResponse(new Response(webStream, { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
    });

    req.on('error', rejectResponse);
    if (bodyBuf && bodyBuf.byteLength > 0) {
      req.end(bodyBuf);
    } else {
      req.end();
    }
  });
}

export interface GuardedFetchOptions {
  /** Override proxy detection (defaults to WORKER_HTTPS_PROXY / HTTPS_PROXY / https_proxy). */
  proxyUrl?: string | null;
  /** Injectable fetch function (used when proxied or in tests). */
  fetch?: typeof globalThis.fetch;
  /** Injectable pinned-IP transport for tests. */
  pinnedTransport?: (
    validated: ValidatedUrl,
    init: RequestInit,
    pinnedLookup: PinnedLookup,
  ) => Promise<Response>;
  /**
   * Optional benchmark answer-key source blocklist enforced before DNS lookup
   * on the initial URL and on every redirect hop. Falls back to any ambient
   * blocklist set via `withEgressBlocklist`.
   */
  blocklist?: SourceBlocklist;
}

const MAX_REDIRECTS = 5;

/**
 * fetch() with the guard applied to the first URL and every redirect hop.
 * Returns the final response (redirect: 'manual' semantics resolved by us).
 *
 * When no egress proxy is active and native `fetch` is in use, every hop binds
 * its verified public IP(s) via `createPinnedLookup` (through `undici.Agent`
 * when available, or Node's `node:https` `pinnedHttpsRequest` otherwise),
 * eliminating the DNS-rebinding TOCTOU race while preserving TLS SNI and `Host`.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit = {},
  resolve?: (host: string) => Promise<string[]>,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const proxyActive =
    options.proxyUrl !== undefined ? Boolean(options.proxyUrl) : hasEgressProxy();
  const customFetch = options.fetch ?? (globalThis.fetch !== NATIVE_FETCH ? globalThis.fetch : undefined);

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await validateAddress(current, resolve, options.blocklist);
    let res: Response;

    if (options.pinnedTransport && !proxyActive) {
      const pinnedLookup = createPinnedLookup(validated.host, validated.addresses);
      res = await options.pinnedTransport(validated, { ...init, redirect: 'manual' }, pinnedLookup);
    } else if (customFetch || proxyActive) {
      const fetchImpl = customFetch ?? globalThis.fetch;
      res = await fetchImpl(current, { ...init, redirect: 'manual' });
    } else {
      const pinnedLookup = createPinnedLookup(validated.host, validated.addresses);
      const UndiciAgent = await loadUndiciAgent();
      if (UndiciAgent) {
        const dispatcher = new UndiciAgent({ connect: { lookup: pinnedLookup } });
        try {
          res = await NATIVE_FETCH(current, {
            ...init,
            redirect: 'manual',
            dispatcher,
          } as RequestInit & { dispatcher: unknown });
        } finally {
          // Close idle connections once the hop finishes (in-flight body stream completes cleanly).
          void dispatcher.close?.().catch(() => {});
        }
      } else {
        res = await pinnedHttpsRequest(validated, { ...init, redirect: 'manual' }, pinnedLookup);
      }
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel?.().catch(() => {});
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    return res;
  }
  throw new EgressBlockedError(url, 'too many redirects');
}
