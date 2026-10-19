import { describe, expect, it } from 'vitest';

/**
 * withAuthContext's backstop against a deadlocked pool: inside its
 * transaction Postgres ends an idle-in-transaction session after
 * IDLE_IN_TRANSACTION_TIMEOUT, and the setting is transaction-local, so the
 * pooled connection goes back to the server's default afterwards (a later
 * system-context transaction is not cut short by it).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('withAuthContext', () => {
  it('bounds how long its transaction may sit idle, for that transaction only', async () => {
    const { getDb, withAuthContext, IDLE_IN_TRANSACTION_TIMEOUT } = await import('./index.js');
    const { sql } = await import('drizzle-orm');
    const db = getDb();
    const show = async (on: Pick<typeof db, 'execute'>) =>
      (await on.execute<{ idle_in_transaction_session_timeout: string }>(sql`show idle_in_transaction_session_timeout`))[0]!
        .idle_in_transaction_session_timeout;

    const before = await show(db);
    expect(before).not.toBe(IDLE_IN_TRANSACTION_TIMEOUT);
    for (const userId of [null, '00000000-0000-0000-0000-000000000001']) {
      expect(await withAuthContext(db, userId, (tx) => show(tx))).toBe(IDLE_IN_TRANSACTION_TIMEOUT);
    }
    expect(await show(db)).toBe(before);
  });
});
