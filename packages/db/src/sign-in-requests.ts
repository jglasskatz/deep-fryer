import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { signInRequests, verificationTokens } from './schema.js';

/**
 * The per-network-address limit on magic-link emails (migration 0016). The
 * sign-in path decides the numbers (how many emails, over how long) and how
 * the address is hashed; this module keeps the ledger and makes the check
 * and the record one atomic step.
 *
 * System context only: the app role has no grant on sign_in_requests, and
 * the check runs before any session exists. Pass the pooled system client
 * (apps/web systemDb()), or a transaction the caller already holds on it.
 */

/**
 * Advisory-lock namespace (the first key of pg_advisory_xact_lock(int, int))
 * that serializes requests from one address while they count and record:
 * without it, a burst of parallel requests would all count the same "under
 * the limit" before any of them inserted, and a pool's worth more emails than
 * the limit would go out. The second key hashes the address hash; a collision
 * only makes two addresses wait for each other briefly. Distinct from the web
 * app's namespaces (lib/involvement-actions.ts 61_001 and 61_002,
 * lib/translation-requests.ts 61_003).
 */
const LOCK_SIGN_IN_ADDRESS = 61_004;

/**
 * The window the per-address limit counts over (apps/web
 * lib/sign-in-limit.ts SIGN_IN_EMAILS_PER_ADDRESS emails in it). Kept here
 * rather than in the web app because the worker's privacy sweep deletes by
 * it too (pruneExpiredSignInRecords): a row outside the window does nothing
 * for the limit, and the privacy notice promises it is not kept.
 */
export const SIGN_IN_EMAIL_WINDOW_MS = 60 * 60 * 1000;

export interface SignInAdmission {
  /** True when the request is within the limit and has been recorded. */
  admitted: boolean;
  /** Requests from this address within the window, this one included when admitted. */
  recent: number;
}

/**
 * Count this address's sign-in requests within the window and, if it is
 * under `limit`, record this one — atomically per address.
 *
 * A refused request is not recorded, so the limit is on emails actually
 * sent: an address that keeps trying is admitted again as soon as its oldest
 * request leaves the window, and hammering the form cannot grow the table.
 * Each call also deletes this address's rows that have left the window, so
 * an address that signs in now and then keeps at most `limit` rows;
 * pruneSignInRequests clears the addresses that never come back.
 *
 * `now` is for tests; the default is the application server's clock, which
 * is also what stamps the row, so the window is measured on one clock.
 */
export async function admitSignInRequest(
  db: DbExecutor,
  args: { ipHash: string; limit: number; windowMs: number; now?: Date },
): Promise<SignInAdmission> {
  if (!args.ipHash) throw new Error('admitSignInRequest: ipHash is required');
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error('admitSignInRequest: limit must be a positive integer');
  if (!(args.windowMs > 0)) throw new Error('admitSignInRequest: windowMs must be positive');
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - args.windowMs);

  return db.transaction(async (tx) => {
    // Held until this transaction ends (see LOCK_SIGN_IN_ADDRESS).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_SIGN_IN_ADDRESS}::int, hashtext(${args.ipHash}))`);
    await tx
      .delete(signInRequests)
      .where(and(eq(signInRequests.ipHash, args.ipHash), lt(signInRequests.createdAt, since)));
    const [row] = await tx
      .select({ n: count() })
      .from(signInRequests)
      .where(and(eq(signInRequests.ipHash, args.ipHash), gte(signInRequests.createdAt, since)));
    const recent = Number(row?.n ?? 0);
    if (recent >= args.limit) return { admitted: false, recent };
    await tx.insert(signInRequests).values({ ipHash: args.ipHash, createdAt: now });
    return { admitted: true, recent: recent + 1 };
  });
}

/**
 * Delete every sign-in request recorded before `before` — for a periodic
 * job, with `before` no later than now minus the limit's window (rows inside
 * the window are what the limit counts). Returns how many were deleted.
 */
export async function pruneSignInRequests(db: DbExecutor, before: Date): Promise<number> {
  const deleted = await db
    .delete(signInRequests)
    .where(lt(signInRequests.createdAt, before))
    .returning({ id: signInRequests.id });
  return deleted.length;
}

/**
 * The privacy sweep (the worker's PRIVACY_SWEEP_TASK, every quarter hour):
 * delete what the sign-in path keeps once it has no use left, as /privacy
 * says.
 *
 * - sign_in_requests rows older than the limit's window
 *   (SIGN_IN_EMAIL_WINDOW_MS): the limit counts only inside it, and each
 *   holds a hash of someone's network address.
 * - verification_tokens rows whose link has expired (15 minutes after it was
 *   sent): Auth.js deletes a row only when its link is used, so an unused
 *   link's row — which holds the email address it was sent to, typed in by
 *   anyone — would otherwise stay for good.
 *
 * System context (the owner pool): the app role has no grant on either
 * table. Returns how many rows went, for the worker's log.
 */
export async function pruneExpiredSignInRecords(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<{ signInRequests: number; verificationTokens: number }> {
  const requests = await pruneSignInRequests(db, new Date(now.getTime() - SIGN_IN_EMAIL_WINDOW_MS));
  const tokens = await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, now))
    .returning({ identifier: verificationTokens.identifier });
  return { signInRequests: requests, verificationTokens: tokens.length };
}
