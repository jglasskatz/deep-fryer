import { format } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { users } from '@deep-fryer/db/schema';
import { action, unwrap, UserError } from './action-result';

/** A value a resident typed, bound to the failing query. */
const RESIDENT = 'resident@example.org';

/** A real ORM query bound to RESIDENT, on a driver that fails it with `failure`. */
function lookupFailingWith(failure: Error) {
  const db = drizzle(async () => {
    throw failure;
  });
  return () => db.select({ id: users.id }).from(users).where(eq(users.email, RESIDENT));
}

/** What console.error printed for an action that failed with `run`'s error. */
async function loggedFor(run: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = await action(run)();
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^Something went wrong/) });
    expect(spy).toHaveBeenCalledTimes(1);
    return format(...spy.mock.calls[0]!);
  } finally {
    spy.mockRestore();
  }
}

describe('action()', () => {
  it('returns data on success', async () => {
    expect(await action(async (n: number) => n * 2)(21)).toEqual({ ok: true, data: 42 });
  });

  it('keeps UserError and zod messages (prod would redact a throw)', async () => {
    expect(await action(async () => { throw new UserError('A change note is required.'); })()).toEqual({
      ok: false,
      error: 'A change note is required.',
    });
    const r = await action(async () => z.object({ email: z.email() }).parse({ email: 'x' }))();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^email: /);
  });

  it('logs and genericizes unexpected errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await action(async () => { throw new Error('connection refused at 10.0.0.5'); })();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain('10.0.0.5');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs what Postgres said about a failed query, without its SQL or bound values', async () => {
    const denied = Object.assign(new Error('permission denied for table users'), {
      name: 'PostgresError',
      code: '42501',
      severity: 'ERROR',
    });
    const text = await loggedFor(lookupFailingWith(denied));
    expect(text).toContain('permission denied for table users (42501)');
    expect(text).not.toContain(RESIDENT);
    expect(text.toLowerCase()).not.toContain('select');
    // Where it was thrown is still in the log.
    expect(text).toMatch(/\n\s+at /);
  });

  it('logs the system code of a refused connection', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
    const text = await loggedFor(lookupFailingWith(refused));
    expect(text).toMatch(/^\[server action\] connect ECONNREFUSED 10\.0\.0\.5:5432/);
    expect(text).not.toContain(RESIDENT);
    expect(text.toLowerCase()).not.toContain('select');
  });

  it('takes stack frames only from below the message, never a frame-like line inside it', async () => {
    const text = await loggedFor(async () => {
      throw new Error('could not save the note\n    at quoted (a line someone typed)');
    });
    expect(text).toMatch(/^\[server action\] could not save the note\n\s+at /);
    expect(text).not.toContain('a line someone typed');
  });

  it('unwrap throws the failure message for the client', () => {
    expect(() => unwrap({ ok: false, error: 'nope' })).toThrow('nope');
    expect(unwrap({ ok: true, data: 1 })).toBe(1);
  });
});
