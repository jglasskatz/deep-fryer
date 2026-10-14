/**
 * Apply SQL migrations at deploy time with drizzle-orm's runtime migrator —
 * the same journal and `drizzle.__drizzle_migrations` bookkeeping as
 * `drizzle-kit migrate`, without shipping drizzle-kit in production images.
 *
 *   MIGRATION_DATABASE_URL=postgres://owner@db/deep_fryer tsx src/migrate.ts
 *
 * Runs as the database owner (MIGRATION_DATABASE_URL, falling back to
 * DATABASE_URL): migrations create roles, policies, and triggers. One
 * connection, one transaction per migration; a failure exits non-zero so the
 * deploy stops before the app starts against a half-migrated schema.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

migrate(drizzle(client), { migrationsFolder })
  .then(async () => {
    console.log(`migrations applied from ${migrationsFolder}`);
    await client.end();
  })
  .catch(async (err) => {
    console.error('migration failed:', err);
    await client.end({ timeout: 1 });
    process.exit(1);
  });
