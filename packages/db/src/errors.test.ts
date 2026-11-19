import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleProxy } from 'drizzle-orm/pg-proxy';
import postgres from 'postgres';
import { errorDetail } from '@deep-fryer/core';
import {
  driverError,
  failureCode,
  isUniqueViolation,
  logSafeError,
  postgresError,
  postgresErrorCode,
  withPostgresError,
} from './errors.js';
import { users } from './schema.js';

/** A driver error as postgres-js builds one from a server ErrorResponse. */
function serverError(code: string, message: string, extra: Record<string, string> = {}) {
  return new postgres.PostgresError({ code, message, severity: 'ERROR', severity_local: 'ERROR', ...extra } as never);
}

/** What drizzle-orm throws from a failed query: its own error, the driver's as `cause`. */
function wrapped(cause: unknown) {
  return new DrizzleQueryError('insert into "t" ("a") values ($1)', ['secret@example.gov'], cause as Error);
}

describe('postgres errors behind the ORM', () => {
  it('finds the unique violation whether or not the ORM wrapped it', () => {
    const dup = serverError('23505', 'duplicate key value violates unique constraint "t_a_uniq"', {
      constraint_name: 't_a_uniq',
    });
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(wrapped(dup))).toBe(true);
    expect(postgresError(wrapped(dup))?.constraint_name).toBe('t_a_uniq');
    // The wrapper's own message is the SQL and its parameters, not the server's.
    expect(wrapped(dup).message).not.toMatch(/duplicate key/);
  });

  it('reports other codes as themselves', () => {
    const rls = serverError('42501', 'new row violates row-level security policy for table "t"');
    expect(postgresErrorCode(wrapped(rls))).toBe('42501');
    expect(isUniqueViolation(wrapped(rls))).toBe(false);
  });

  it('finds nothing when the failure did not come from the server', () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const pipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    expect(postgresError(wrapped(reset))).toBeUndefined();
    expect(postgresError(pipe)).toBeUndefined();
    expect(postgresError(null)).toBeUndefined();
    expect(postgresError('23505')).toBeUndefined();
    expect(postgresError({ code: '23505', severity: 'ERROR' })).toBeUndefined();
  });

  it('stops on a cause chain that loops', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(postgresError(a)).toBeUndefined();
  });

  it('rejects with the server error, so its own message can be matched', async () => {
    const trigger = serverError('P0001', 'a published version is never rewritten');
    await expect(withPostgresError(Promise.reject(wrapped(trigger)))).rejects.toThrow(/never rewritten/);
    const other = new Error('not from the database');
    await expect(withPostgresError(Promise.reject(other))).rejects.toBe(other);
    await expect(withPostgresError(Promise.resolve(7))).resolves.toBe(7);
  });

  it('takes the query wrapper off, so a message never carries SQL or parameters', () => {
    const rls = serverError('42501', 'new row violates row-level security policy for table "t"');
    expect(driverError(wrapped(rls))).toBe(rls);
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    expect((driverError(wrapped(refused)) as Error).message).toBe('connect ECONNREFUSED 127.0.0.1:5432');
    expect((driverError(wrapped(refused)) as Error).message).not.toMatch(/secret@example\.gov|insert into/);
    const own = new Error('Select at least one dimension.');
    expect(driverError(own)).toBe(own);
    expect(driverError(rls)).toBe(rls);
    expect(driverError('plain')).toBe('plain');
  });
});

/** A value a resident typed, bound to the failing query below. */
const RESIDENT = 'resident@example.org';

/** Runs a real select bound to RESIDENT and returns what the ORM threw. */
async function failedLookup(db: ReturnType<typeof drizzleProxy> | ReturnType<typeof drizzlePostgres>): Promise<unknown> {
  try {
    await db.select({ id: users.id }).from(users).where(eq(users.email, RESIDENT));
  } catch (err) {
    return err;
  }
  throw new Error('the query was expected to fail');
}

/** Log text never holds the bound value or any SQL. */
function expectNoQueryText(text: string) {
  expect(text).not.toContain(RESIDENT);
  expect(text.toLowerCase()).not.toContain('select');
  expect(text).not.toContain('"users"');
}

describe('log-safe descriptions of a failed query', () => {
  it('keeps what Postgres said and its code, never the SQL or the bound values', async () => {
    // The ORM's real query path, with a driver that answers as Postgres does
    // when the role may not read the table.
    const denied = serverError('42501', 'permission denied for table users');
    const db = drizzleProxy(async () => {
      throw denied;
    });
    const err = await failedLookup(db);
    expect(err).toBeInstanceOf(DrizzleQueryError);
    // The ORM's own message is exactly what must not be logged.
    expect((err as Error).message).toContain(RESIDENT);
    const line = logSafeError(err);
    expect(line).toBe('permission denied for table users (42501)');
    expectNoQueryText(line);
    expect(failureCode(err)).toBe('42501');
  });

  it('reports a refused connection by its network reason and system code', async () => {
    // A real postgres-js connection to a port nothing listens on.
    const client = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      const err = await failedLookup(drizzlePostgres(client));
      expect(err).toBeInstanceOf(DrizzleQueryError);
      expect(failureCode(err)).toBe('ECONNREFUSED');
      const line = logSafeError(err);
      expect(line).toMatch(/^connect ECONNREFUSED 127\.0\.0\.1:1/);
      expectNoQueryText(line);
      // The operator preflight's line for the same failure starts the same way.
      expect(errorDetail(err)).toMatch(/^connect ECONNREFUSED/);
      expect(errorDetail(err)).not.toMatch(/Failed query/);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('finds a code on any link, and none on an error of our own', () => {
    const timeout = Object.assign(new Error('write CONNECT_TIMEOUT db:5432'), { code: 'CONNECT_TIMEOUT' });
    expect(failureCode(wrapped(timeout))).toBe('CONNECT_TIMEOUT');
    expect(failureCode(new Error('outer', { cause: wrapped(timeout) }))).toBe('CONNECT_TIMEOUT');
    expect(failureCode(new Error('tenant t-1 missing'))).toBeUndefined();
    expect(failureCode(null)).toBeUndefined();
    // A wrapper buried in our own error is still left out of the line.
    const nested = new Error('apply failed', { cause: wrapped(serverError('23505', 'duplicate key value violates unique constraint "t_a_uniq"')) });
    expect(logSafeError(nested)).toBe('apply failed: duplicate key value violates unique constraint "t_a_uniq" (23505)');
    expect(logSafeError(wrapped(undefined))).toBe('database query failed');
  });
});
