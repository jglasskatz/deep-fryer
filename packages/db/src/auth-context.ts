import { sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long one of these transactions may sit idle — holding its pooled
 * connection with no query running — before Postgres ends it. A request's
 * transaction runs its queries back to back and calls nothing slow in
 * between, so it is never idle for anywhere near this long. The one way it
 * is: code inside `fn` that waits for a second pooled connection (another
 * transaction, or a query on the pooled client) while this one is held. With
 * as many such requests at once as the pool has connections, each waits for
 * a connection another holds, and nothing in the client or the server would
 * ever end the wait — every request in the process would hang until a
 * restart. Callers must not nest like that (apps/web lib/features.ts,
 * lib/discussion.ts); this is the backstop, so a mistake costs those requests
 * an error after this long instead of taking the whole process down for good.
 */
export const IDLE_IN_TRANSACTION_TIMEOUT = '30s';

/**
 * Run `fn` under database-enforced access control (SPEC-v3 §2.2): one
 * transaction that switches to the non-owner `deep_fryer_app` role and sets
 * `app.user_id` (read by auth.uid() in every policy) for its duration only.
 * `userId` null means an anonymous visitor: only public-read policies match.
 *
 * Everything inside sees exactly what the policies allow — an app-layer bug
 * that forgets a tenant filter still cannot read another city's drafts.
 * Call it on the pooled client, not inside another transaction: SET LOCAL
 * would otherwise outlive this call in the enclosing transaction.
 */
export async function withAuthContext<T>(
  db: DbExecutor,
  userId: string | null,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  if (userId !== null && !UUID_RE.test(userId)) throw new Error('withAuthContext: userId must be a uuid');
  return db.transaction(async (tx) => {
    // Both transaction-local (the `true`), so neither outlives this call on
    // the pooled connection; one statement, so the backstop costs no round trip.
    await tx.execute(
      sql`select set_config('app.user_id', ${userId ?? ''}, true),
                 set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TRANSACTION_TIMEOUT}, true)`,
    );
    await tx.execute(sql.raw('set local role deep_fryer_app'));
    return fn(tx);
  });
}
