import { sql } from 'drizzle-orm';
import type { getDb } from './client.js';

type Db = ReturnType<typeof getDb>;

/**
 * The public read path (SPEC.md §11): published versions only, via the same
 * SQL function RLS-governed clients use.
 */
export async function publishedDoughnut<T = unknown>(db: Db, slug: string): Promise<T | null> {
  const result = await db.execute<{ portrait: T | null }>(
    sql`SELECT published_doughnut(${slug}) AS portrait`,
  );
  return result[0]?.portrait ?? null;
}
