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
import { errorDetail } from '@deep-fryer/core';

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

/** Room for a cause chain of a few links; a log line is not a dump. */
const LOG_LINE_MAX = 600;

/**
 * A failure as one line a server log may keep: what Postgres or the network
 * said and its code (SQLSTATE, or a system code such as ECONNREFUSED), for
 * every link of the cause chain. The ORM's query wrapper adds nothing: its
 * message is the SQL text and the bound values, which can carry a resident's
 * contact details, free-text notes or a whole research payload. Postgres's
 * DETAIL field, which quotes the offending row, is never read either.
 *
 * The rule itself is core's errorDetail, which the operator preflight shares
 * and which the web app's action wrapper calls directly, because that module
 * is also loaded in the browser and cannot import this package.
 */
export function logSafeError(err: unknown): string {
  return errorDetail(err, LOG_LINE_MAX);
}

/**
 * The code behind a failure: the SQLSTATE Postgres sent, or else the first
 * system code on the cause chain (ECONNREFUSED, ETIMEDOUT, postgres-js's
 * CONNECT_TIMEOUT), so a refused or timed-out connection is still told apart
 * from a bug in our own code. Undefined when nothing on the chain has one.
 */
export function failureCode(err: unknown): string | undefined {
  const pg = postgresErrorCode(err);
  if (pg) return pg;
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
