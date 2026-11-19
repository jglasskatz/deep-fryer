import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import postgres from 'postgres';
import { driverError, isUniqueViolation, postgresError, postgresErrorCode, withPostgresError } from './errors.js';

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
