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

/** Expand a validated IPv6 address, including a dotted IPv4 tail, into eight words. */
function ipv6Words(ip: string): number[] {
  // isIP accepts a zone identifier; it does not change the address being classified.
  let address = ip.split('%')[0]!;
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const ipv4 = ipv4ToInt(address.slice(lastColon + 1));
    address = `${address.slice(0, lastColon + 1)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const [head, tail] = address.split('::');
  const words = (part: string) => part ? part.split(':').map((word) => parseInt(word, 16)) : [];
  const left = words(head!);
  if (tail === undefined) return left;
  const right = words(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const words = ipv6Words(ip);
    if (words.slice(0, 7).every((word) => word === 0) && words[7]! <= 1) return true;
    // IPv4-mapped IPv6 is ::ffff:0:0/96. URL parsing normalizes dotted tails
    // to hexadecimal, so matching only ::ffff:a.b.c.d leaves a bypass.
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
      const high = words[6]!;
      const low = words[7]!;
      return isPrivateAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    const first = words[0]!;
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
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
