import { sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    await tx.execute(sql`select set_config('app.user_id', ${userId ?? ''}, true)`);
    await tx.execute(sql.raw('set local role deep_fryer_app'));
    return fn(tx);
  });
}
