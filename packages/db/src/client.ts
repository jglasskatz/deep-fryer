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

/**
 * Where the process's one client lives: on globalThis, under a registry
 * symbol, not in a module-level variable. Next.js bundles this module more
 * than once into the web server — the page (RSC) layer, the server-action
 * layer and the Node-runtime middleware each get their own copy, with their
 * own module variables — so a module-level cache built one pool per copy:
 * three pools, 3 × DATABASE_POOL_MAX connections per web process. Every copy
 * sees the same globalThis and Symbol.for key, so they share one pool.
 * Exported for test/one-connection.ts in apps/web, which swaps in a
 * one-connection pool for the length of a test.
 */
export const DB_CLIENT_KEY: unique symbol = Symbol.for('deep-fryer.db');

type ClientHolder = { [DB_CLIENT_KEY]?: DrizzleClient };

export function getDb(): DrizzleClient {
  const holder = globalThis as ClientHolder;
  const cached = holder[DB_CLIENT_KEY];
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const sql = postgres(url, {
    prepare: false,
    // Bounded pool, one per process (see DB_CLIENT_KEY): web replicas × max,
    // plus each worker's pools, must stay under Postgres max_connections.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
  const client = drizzle(sql, { schema });
  holder[DB_CLIENT_KEY] = client;
  return client;
}

export const db: DrizzleClient = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    const real = getDb();
    return Reflect.get(real as object, prop, receiver);
  },
});
