import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { action, unwrap, UserError } from './action-result';

describe('action()', () => {
  it('returns data on success', async () => {
    expect(await action(async (n: number) => n * 2)(21)).toEqual({ ok: true, data: 42 });
  });

  it('keeps UserError and zod messages (prod would redact a throw)', async () => {
    expect(await action(async () => { throw new UserError('A change note is required.'); })()).toEqual({
      ok: false,
      error: 'A change note is required.',
    });
    const r = await action(async () => z.object({ email: z.string().email() }).parse({ email: 'x' }))();
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

  it('unwrap throws the failure message for the client', () => {
    expect(() => unwrap({ ok: false, error: 'nope' })).toThrow('nope');
    expect(unwrap({ ok: true, data: 1 })).toBe(1);
  });
});
