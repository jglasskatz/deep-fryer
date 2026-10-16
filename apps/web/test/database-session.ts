/**
 * For tests only: what Auth.js's auth() returns for `userId`, read the way
 * production reads it — a query on the pooled client, on every call. The
 * real auth() reads the database session through DrizzleAdapter(getDb()),
 * and in a server action React's cache() does not memoize getAuth(), so
 * every getAuth() there costs that query.
 *
 * Mock `@/auth` with this (not with a canned session object) where a test
 * runs actions on a one-connection pool (test/one-connection.ts): a
 * getAuth() inside a transaction — directly, or through audit() or
 * requireUserId() — then asks for a second pooled connection exactly as it
 * would in production, and the test hangs instead of passing by accident.
 *
 *   vi.mock('@/auth', () => ({
 *     auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
 *   }));
 *
 * Imports are dynamic so a one-connection run (which reloads modules) reads
 * through its own pool. A user with no row has no session, as in Auth.js.
 */
export async function databaseSession(userId: string | null) {
  if (!userId) return null;
  const { getDb, users } = await import('@deep-fryer/db');
  const { eq } = await import('drizzle-orm');
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  return {
    user: { id: user.id, email: user.email, name: user.name, displayName: user.displayName, isStaff: user.isStaff },
  };
}
