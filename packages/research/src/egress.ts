import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Worker egress guard (SPEC-v3 §2.3). Research agents choose the URLs the
 * worker fetches (source checks, evidence capture), so every fetch is
 * treated as attacker-influenced: https only, and the host must resolve
 * exclusively to public addresses — never loopback, RFC 1918, link-local
 * (cloud metadata at 169.254.169.254), CGNAT, or the IPv6 equivalents.
 * Redirects are followed by hand so every hop is re-checked.
 *
 * DNS is resolved here and checked before connecting. A rebinding race
 * between this lookup and the socket's own lookup remains theoretically
 * possible; production egress additionally goes through the allowlist proxy
 * (apps/worker/README.md), which is the layer that pins connections.
 */

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

/** Throws EgressBlockedError unless `raw` is an https URL whose host resolves only to public IPs. */
export async function assertPublicHttpsUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressBlockedError(raw, 'not a URL');
  }
  if (url.protocol !== 'https:') throw new EgressBlockedError(raw, 'only https is allowed');
  if (url.username || url.password) throw new EgressBlockedError(raw, 'credentials in URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new EgressBlockedError(raw, 'host does not resolve');
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new EgressBlockedError(raw, `resolves to non-public address ${bad}`);
  return url;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

const MAX_REDIRECTS = 5;

/**
 * fetch() with the guard applied to the first URL and every redirect hop.
 * Returns the final response (redirect: 'manual' semantics resolved by us).
 */
export async function guardedFetch(
  url: string,
  init: RequestInit = {},
  resolve?: (host: string) => Promise<string[]>,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpsUrl(current, resolve);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    return res;
  }
  throw new EgressBlockedError(url, 'too many redirects');
}
