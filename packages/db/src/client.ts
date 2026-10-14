import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Anything queries can run on: the pooled client or a transaction. Write
 * helpers accept this so callers can compose them inside one transaction.
 */
export type DbExecutor = PgDatabase<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

let cached: DrizzleClient | null = null;

export function getDb(): DrizzleClient {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const sql = postgres(url, {
    prepare: false,
    // Bounded pool: web replicas × max must stay under Postgres max_connections.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
  cached = drizzle(sql, { schema });
  return cached;
}

export const db: DrizzleClient = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    const real = getDb();
    return Reflect.get(real as object, prop, receiver);
  },
});
