import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUBMISSION_LIMITS } from '@deep-fryer/core';
import { issueFormToken, purposeKey, verifyFormToken } from './form-token';

/**
 * The public form's signed token (SPEC-v6 §4.2): a token this server issued
 * for this portrait verifies once it is old enough for a person to have
 * filled the form, and until it is a day old; anything else — another
 * portrait's token, an edited issue time, a forged or truncated signature,
 * a token signed with another secret — is invalid.
 */

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const SCOPE = 'nyc';

describe('form tokens', () => {
  const saved = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = 'form-token-test-secret';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  it('has the documented shape', () => {
    expect(issueFormToken(SCOPE, T0)).toMatch(new RegExp(`^${T0}\\.[A-Za-z0-9_-]{43}$`));
  });

  it('is ok between the minimum fill time and the maximum age', () => {
    const token = issueFormToken(SCOPE, T0);
    expect(verifyFormToken(token, SCOPE, T0 + SUBMISSION_LIMITS.minFillMs)).toBe('ok');
    expect(verifyFormToken(token, SCOPE, T0 + 60_000)).toBe('ok');
    expect(verifyFormToken(token, SCOPE, T0 + SUBMISSION_LIMITS.maxTokenAgeMs)).toBe('ok');
  });

  it('is too fast before the minimum fill time, including from a clock slightly behind', () => {
    const token = issueFormToken(SCOPE, T0);
    expect(verifyFormToken(token, SCOPE, T0)).toBe('too_fast');
    expect(verifyFormToken(token, SCOPE, T0 + SUBMISSION_LIMITS.minFillMs - 1)).toBe('too_fast');
    expect(verifyFormToken(token, SCOPE, T0 - 500)).toBe('too_fast');
  });

  it('is expired after the maximum age', () => {
    const token = issueFormToken(SCOPE, T0);
    expect(verifyFormToken(token, SCOPE, T0 + SUBMISSION_LIMITS.maxTokenAgeMs + 1)).toBe('expired');
  });

  it('is invalid for another portrait, or when anything was changed', () => {
    const token = issueFormToken(SCOPE, T0);
    const later = T0 + 10_000;
    expect(verifyFormToken(token, 'brooklyn', later)).toBe('invalid');

    // Backdating the issue time to skip the minimum fill time breaks the signature.
    const [, signature] = token.split('.');
    expect(verifyFormToken(`${T0 - 60_000}.${signature}`, SCOPE, T0 + 1)).toBe('invalid');

    // One character of the signature flipped.
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyFormToken(`${token.slice(0, -1)}${last}`, SCOPE, later)).toBe('invalid');

    for (const junk of ['', 'abc', `${T0}`, `${T0}.`, `${T0}.short`, `x${token}`, `${token}x`, `-1.${signature}`]) {
      expect(verifyFormToken(junk, SCOPE, later)).toBe('invalid');
    }
    for (const notString of [null, undefined, 42, { token }]) {
      expect(verifyFormToken(notString, SCOPE, later)).toBe('invalid');
    }
  });

  it('is invalid when signed with another secret', () => {
    const token = issueFormToken(SCOPE, T0);
    process.env.AUTH_SECRET = 'a-rotated-secret';
    expect(verifyFormToken(token, SCOPE, T0 + 10_000)).toBe('invalid');
  });

  it('derives a distinct key per purpose', () => {
    expect(purposeKey('form-token').equals(purposeKey('involvement-address'))).toBe(false);
    expect(purposeKey('form-token').equals(Buffer.from(process.env.AUTH_SECRET!, 'utf8'))).toBe(false);
  });

  it('signs with a per-process secret in local development without AUTH_SECRET', () => {
    delete process.env.AUTH_SECRET;
    const token = issueFormToken(SCOPE, T0);
    expect(verifyFormToken(token, SCOPE, T0 + 10_000)).toBe('ok');
  });
});
