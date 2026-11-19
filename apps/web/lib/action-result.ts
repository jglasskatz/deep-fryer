import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { errorDetail } from '@deep-fryer/core';

/**
 * Server actions return values, never throw (SPEC-v3 §2.3). Production
 * Next.js redacts thrown server-action errors to a generic digest, which
 * swallowed every validation message in v2 ("a change note is required"
 * reached users as "An error occurred"). Actions are wrapped in action():
 *
 * - UserError / ZodError → { ok: false, error } with the message intact;
 * - anything else → logged server-side, generic message to the client
 *   (internal details never leak);
 * - Next's control-flow errors (redirect, notFound) are rethrown untouched.
 *
 * Clients unwrap with `unwrap()` inside useAction, which surfaces the message.
 */

/** An error whose message is safe and useful to show the person who caused it. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC = 'Something went wrong on our side. It has been logged — try again in a moment.';

function zodMessage(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Invalid input.';
  const where = first.path.length ? `${first.path.join('.')}: ` : '';
  return `${where}${first.message}`;
}

export function action<I extends unknown[], O>(
  fn: (...input: I) => Promise<O>,
): (...input: I) => Promise<ActionResult<O>> {
  return async (...input: I): Promise<ActionResult<O>> => {
    try {
      return { ok: true, data: await fn(...input) };
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof UserError) return { ok: false, error: err.message };
      if (err instanceof ZodError) return { ok: false, error: zodMessage(err) };
      console.error('[server action]', logLine(err));
      return { ok: false, error: GENERIC };
    }
  };
}

/** A log line is long enough for a short cause chain; it is not a dump. */
const LOG_LINE_MAX = 600;

/**
 * What the server log keeps of an unexpected failure: the reason as one line
 * (what Postgres or the network said, with its code) and where it was thrown.
 * The error itself is never logged, because a failed query's error carries
 * the SQL text and the values bound to it, which may be a resident's contact
 * details, in its message, its stack and its fields. Stack frames hold only
 * function names and file positions, so they are kept.
 *
 * This is packages/db logSafeError's rule, called from core: client
 * components import this module for unwrap(), so it must not load the
 * database package.
 */
function logLine(err: unknown): string {
  const reason = errorDetail(err, LOG_LINE_MAX);
  const frames = stackFrames(err);
  return frames.length ? `${reason}\n${frames.join('\n')}` : reason;
}

/**
 * The "at …" lines of an error's stack. V8 writes the stack as the message
 * and then the frames, and a bound value inside the message could itself
 * contain a line that looks like a frame, so the message is cut off first;
 * a stack that does not begin with its message gives no frames at all.
 */
function stackFrames(err: unknown): string[] {
  if (!(err instanceof Error) || typeof err.stack !== 'string') return [];
  const header = err.message ? `${err.name}: ${err.message}` : err.name;
  if (!err.stack.startsWith(header)) return [];
  return err.stack
    .slice(header.length)
    .split('\n')
    .filter((line) => /^\s+at /.test(line));
}

/** Client side: turn a failed result back into a thrown Error for useAction to display. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
