import 'server-only';
import { createHmac } from 'node:crypto';
import { purposeKey } from './form-token';

/**
 * The network address a public request came from, for the abuse limits of
 * forms that need no account (SPEC-v6 §4.2) — and only ever stored as a
 * keyed hash.
 *
 * Where the address comes from: in production every request reaches Next
 * through Caddy (deploy/Caddyfile, `reverse_proxy web:3000`; the web
 * container publishes no port of its own). Caddy's reverse_proxy *replaces*
 * any X-Forwarded-For the client sent with the address it accepted the
 * connection from, unless `trusted_proxies` is configured (it is not), so
 * the first entry is the real client and cannot be forged from outside.
 * X-Real-IP is the convention of other proxies (nginx), kept as a fallback
 * for deployments behind one. Neither header present (a direct request in
 * local development) is 'unknown': every such request then shares one rate
 * limit, which is the safe direction to fail in.
 *
 * If a deployment ever adds a proxy or CDN in front of Caddy, configure
 * Caddy's `trusted_proxies` for it — otherwise every visitor would appear to
 * come from the CDN's addresses and share one limit.
 */

/** Anything longer than an IPv6 address with a zone is not an address; keep it bounded either way. */
const MAX_ADDRESS_LENGTH = 64;

/** Minimal interface of the request headers (next/headers' ReadonlyHeaders, or a Fetch Headers). */
export interface HeaderReader {
  get(name: string): string | null;
}

function firstToken(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first ? first.slice(0, MAX_ADDRESS_LENGTH) : null;
}

/** The client's address as the proxy reported it: X-Forwarded-For's first entry, then X-Real-IP, then 'unknown'. */
export function clientAddress(headers: HeaderReader): string {
  return firstToken(headers.get('x-forwarded-for')) ?? firstToken(headers.get('x-real-ip')) ?? 'unknown';
}

/**
 * The stored stand-in for an address: HMAC-SHA256 under a key derived from
 * the server secret for this purpose alone, hex, truncated to 128 bits.
 * Keyed, so the database alone cannot be used to test which address a row
 * came from (an unkeyed hash of the IPv4 space is a few seconds' work);
 * stable, so the rate limit can count it. Lower-cased first so the two
 * spellings of one IPv6 address count together.
 */
export function addressHash(address: string): string {
  return createHmac('sha256', purposeKey('involvement-address'))
    .update(address.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}
