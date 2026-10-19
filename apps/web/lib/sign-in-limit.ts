import 'server-only';
import { createHmac } from 'node:crypto';
import { and, count, eq, gt } from 'drizzle-orm';
import { SIGN_IN_EMAIL_WINDOW_MS, admitSignInRequest, getDb, pruneSignInRequests, verificationTokens } from '@deep-fryer/db';
import { purposeKey } from './form-token';

/**
 * The limits on sign-in emails (SPEC-v3 §2.1 magic links). Anyone can type
 * any address into the sign-in form, and every request sends a real email
 * from the deployment's domain: without limits the form mails strangers in
 * bulk and spends the domain's sending reputation. Two rules, both decided
 * before Auth.js makes a token or sends anything (auth.ts callbacks.signIn):
 *
 * - Per recipient: at most MAX_OUTSTANDING_LINKS unexpired links at once, so
 *   one inbox cannot be flooded; asking again waits until a link is used or
 *   expires (15 minutes).
 * - Per network address: at most SIGN_IN_EMAILS_PER_ADDRESS emails an hour,
 *   to any recipients — the rule that stops one source cycling through
 *   addresses. Recorded in sign_in_requests (migration 0016) as a keyed hash
 *   only, and counted and recorded in one step per address under an
 *   advisory lock (packages/db admitSignInRequest), so a burst of parallel
 *   requests cannot slip extra emails past the count. Shared Wi-Fi or an
 *   office NAT counts as one network.
 *
 * The recipient rule runs first and records nothing, so a refusal for one
 * inbox does not spend the network's allowance: only emails about to be
 * sent count against it.
 *
 * System context (the owner pool, as auth.ts's adapter uses): no session
 * exists yet, and the app role has no grant on either table.
 */

/** Unexpired sign-in links one email address may hold at once. */
export const MAX_OUTSTANDING_LINKS = 3;

/**
 * Sign-in emails one network address may cause per SIGN_IN_EMAIL_WINDOW_MS
 * (an hour; defined in packages/db, whose sweep deletes by it too).
 */
export const SIGN_IN_EMAILS_PER_ADDRESS = 10;
export { SIGN_IN_EMAIL_WINDOW_MS };

/**
 * Rows older than this are of no use to the limit: it is the limit's own
 * window. The worker's privacy sweep deletes them every quarter hour
 * (packages/db pruneExpiredSignInRecords — what /privacy promises); this
 * path also sweeps now and then, on about one admitted request in
 * PRUNE_ONE_IN, so the table stays small on a deployment whose worker is
 * stopped. Each address's own expired rows are already deleted whenever it
 * asks again.
 */
export const PRUNE_AFTER_MS = SIGN_IN_EMAIL_WINDOW_MS;
const PRUNE_ONE_IN = 20;

/** Why a sign-in email was not sent, as the sign-in page's error code (en.ts login.errors). */
export type SignInEmailRefusal = 'TooManyLinks' | 'TooManyEmails';

/**
 * The stored stand-in for a network address (lib/client-address.ts
 * clientAddress): HMAC-SHA256 under a key for this purpose alone, so a row
 * here cannot be matched against the involvement form's or the translation
 * requests' hashes of the same address. Lower-cased so both spellings of an
 * IPv6 address count together.
 */
export function signInAddressHash(address: string): string {
  return createHmac('sha256', purposeKey('sign-in-address'))
    .update(address.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

/**
 * Whether a sign-in email to `email` (as Auth.js normalized it, the
 * verification token's identifier), requested from network `address`, may
 * go out: null when it may — it is then counted against the address — or
 * the reason it may not.
 *
 * `now` and `random` (the pruning draw) are for tests.
 */
export async function signInEmailRefusal(input: {
  email: string;
  address: string;
  now?: Date;
  random?: () => number;
}): Promise<SignInEmailRefusal | null> {
  const db = getDb();
  const now = input.now ?? new Date();

  // Counted before Auth.js stores this request's token (the callback runs
  // first), so the bound is exact.
  const [links] = await db
    .select({ n: count() })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, input.email), gt(verificationTokens.expires, now)));
  if (Number(links?.n ?? 0) >= MAX_OUTSTANDING_LINKS) return 'TooManyLinks';

  const { admitted } = await admitSignInRequest(db, {
    ipHash: signInAddressHash(input.address),
    limit: SIGN_IN_EMAILS_PER_ADDRESS,
    windowMs: SIGN_IN_EMAIL_WINDOW_MS,
    now,
  });
  if (!admitted) return 'TooManyEmails';

  if ((input.random ?? Math.random)() * PRUNE_ONE_IN < 1) {
    try {
      await pruneSignInRequests(db, new Date(now.getTime() - PRUNE_AFTER_MS));
    } catch (err) {
      // Housekeeping only: the limit counts within its window whatever is
      // left over, and this request has been admitted and recorded already.
      console.warn('[sign-in] could not prune old sign-in requests', err);
    }
  }
  return null;
}
