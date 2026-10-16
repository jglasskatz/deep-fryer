import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SUBMISSION_LIMITS } from '@deep-fryer/core';
import { isProduction } from './env';

/**
 * Signed form tokens for the public forms that need no account (SPEC-v6
 * §4.2). The page issues a token when it renders the form; the server
 * action refuses a submission whose token is not one this server signed for
 * this portrait, was filled in less than SUBMISSION_LIMITS.minFillMs (a
 * script, not a person), or is older than SUBMISSION_LIMITS.maxTokenAgeMs
 * (a page left open overnight — reload for a fresh one).
 *
 * Shape: `<issuedAtMs>.<base64url HMAC-SHA256(key, scope + '.' + issuedAtMs)>`.
 * The issue time travels in the clear — it is not a secret, and the
 * signature covers it, so it cannot be backdated to skip the minimum fill
 * time. The scope (the portrait's slug) is not in the token: verification
 * recomputes the signature for the scope the submission names, so a token
 * from one portrait's page does not work on another's.
 *
 * Tokens are stateless and can be replayed within their lifetime; that is
 * accepted on purpose. They only prove that the page was loaded by
 * something that waited like a person; the per-address and per-email rate
 * limits and staff review stop repeated submissions.
 */

/** Per-process fallback for local development without AUTH_SECRET (see serverSecret). */
let devSecret: Buffer | null = null;

/**
 * The server's signing secret: AUTH_SECRET, which every deployment already
 * has (Auth.js signs sessions with it, and production refuses to boot
 * without it — lib/env.ts). Local development may run without it (dev-mode
 * auth); then a random secret is made once per process, so tokens stop
 * verifying after a restart and the form asks the person to reload, which
 * is harmless locally. Read at call time rather than at import, so tests
 * and a rotated secret take effect without reloading the module.
 *
 * Shared with lib/client-address.ts (address hashing). Every use derives
 * its own key with purposeKey, so a value computed for one purpose can
 * never be replayed as another.
 */
export function serverSecret(): Buffer {
  const configured = process.env.AUTH_SECRET;
  if (configured) return Buffer.from(configured, 'utf8');
  if (isProduction()) {
    // Unreachable in a correctly started server (assertProductionEnv), but a
    // per-process random secret would break tokens across replicas, so fail
    // loudly rather than degrade quietly.
    throw new Error('AUTH_SECRET is not set: refusing to sign form tokens in production');
  }
  devSecret ??= randomBytes(32);
  return devSecret;
}

/**
 * A key for one purpose, derived from the server secret (HMAC as a KDF).
 * Domain separation: the form-token key and the address-hash key differ,
 * and neither is the raw AUTH_SECRET Auth.js also derives its keys from.
 */
export function purposeKey(purpose: string): Buffer {
  return createHmac('sha256', serverSecret()).update(`deep-fryer:${purpose}`).digest();
}

function sign(scope: string, issuedAtMs: number): Buffer {
  return createHmac('sha256', purposeKey('form-token')).update(`${scope}.${issuedAtMs}`).digest();
}

/**
 * A token for a form shown now on the page `scope` names (the portrait's
 * slug). `now` exists for tests; pages always use the current time.
 */
export function issueFormToken(scope: string, now: number = Date.now()): string {
  const issuedAtMs = Math.floor(now);
  return `${issuedAtMs}.${sign(scope, issuedAtMs).toString('base64url')}`;
}

export type FormTokenVerdict = 'ok' | 'too_fast' | 'expired' | 'invalid';

/** Issue time in milliseconds (13 digits until the year 2286), then a 32-byte signature in base64url. */
const TOKEN_RE = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/;

/**
 * Whether `token` is a valid token for `scope` at time `now`:
 *
 * - 'invalid'  — malformed, or not signed by this server for this scope;
 * - 'too_fast' — signed, but younger than SUBMISSION_LIMITS.minFillMs
 *   (including an issue time slightly ahead of this replica's clock);
 * - 'expired'  — signed, but older than SUBMISSION_LIMITS.maxTokenAgeMs;
 * - 'ok'.
 *
 * The signature is checked before the age, so the age verdicts are only
 * ever given about tokens this server issued.
 */
export function verifyFormToken(token: unknown, scope: string, now: number = Date.now()): FormTokenVerdict {
  if (typeof token !== 'string') return 'invalid';
  const match = TOKEN_RE.exec(token);
  if (!match) return 'invalid';
  const issuedAtMs = Number(match[1]);
  if (!Number.isSafeInteger(issuedAtMs)) return 'invalid';
  const given = Buffer.from(match[2]!, 'base64url');
  const expected = sign(scope, issuedAtMs);
  // timingSafeEqual requires equal lengths; the regex already fixes the
  // encoded length, and this guards the decoded one.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';
  const age = now - issuedAtMs;
  if (age < SUBMISSION_LIMITS.minFillMs) return 'too_fast';
  if (age > SUBMISSION_LIMITS.maxTokenAgeMs) return 'expired';
  return 'ok';
}
