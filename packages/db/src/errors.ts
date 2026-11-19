/**
 * Reading what Postgres said when a query fails.
 *
 * drizzle-orm (0.44 and later) does not throw the driver's error: it throws
 * its own query error, whose message is the SQL text and its parameters, and
 * keeps the driver's error as `cause`. A failure outside a query builder —
 * a COMMIT, or a raw postgres-js call — still throws the driver's error
 * directly. Code that branches on a Postgres error, or a test that matches
 * its message, reads it through these helpers so either shape works.
 */

import { DrizzleQueryError } from 'drizzle-orm/errors';

/** The fields Postgres sends with every error response (both Node drivers carry them). */
export interface PostgresErrorFields extends Error {
  /** SQLSTATE, e.g. '23505' for a unique violation. */
  code: string;
  severity: string;
  constraint_name?: string;
}

/** SQLSTATE codes are five characters of digits and capital letters. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Cause chains are short; the bound only guards against a cycle. */
const MAX_CAUSE_DEPTH = 8;

function isPostgresError(value: unknown): value is PostgresErrorFields {
  if (!(value instanceof Error)) return false;
  const v = value as Partial<PostgresErrorFields>;
  // `severity` tells a server error apart from a Node system error such as
  // EPIPE, whose code would also pass the SQLSTATE pattern.
  return typeof v.code === 'string' && SQLSTATE.test(v.code) && typeof v.severity === 'string';
}

/**
 * The error Postgres raised, found on `err` itself or along its `cause`
 * chain; undefined when the failure did not come from the server (a dropped
 * connection, a bug in our own code).
 */
export function postgresError(err: unknown): PostgresErrorFields | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    if (isPostgresError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The SQLSTATE of the Postgres error behind `err`, if there is one. */
export function postgresErrorCode(err: unknown): string | undefined {
  return postgresError(err)?.code;
}

const UNIQUE_VIOLATION = '23505';

/** Postgres unique_violation: another row already holds this key. */
export function isUniqueViolation(err: unknown): boolean {
  return postgresErrorCode(err) === UNIQUE_VIOLATION;
}

/**
 * Settles like `promise`, except that a rejection carries the Postgres error
 * itself rather than the ORM's wrapper, so a caller (or a test) can match the
 * database's own message — a row-level security refusal, a trigger's
 * explanation. A rejection that did not come from Postgres passes unchanged.
 */
export async function withPostgresError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    throw postgresError(err) ?? err;
  }
}

/**
 * The error the database driver threw, with the ORM's query wrapper taken
 * off: the wrapper's message is the SQL text and its bound parameters, which
 * must not reach a response body, while the driver's message is what Postgres
 * (or the network) actually said. Anything that is not the wrapper — a
 * validation error, an error from our own code — is returned as it is.
 */
export function driverError(err: unknown): unknown {
  return err instanceof DrizzleQueryError && err.cause !== undefined ? err.cause : err;
}
