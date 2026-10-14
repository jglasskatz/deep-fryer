import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';

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
      console.error('[server action]', err);
      return { ok: false, error: GENERIC };
    }
  };
}

/** Client side: turn a failed result back into a thrown Error for useAction to display. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
