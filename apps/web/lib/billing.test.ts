import { describe, expect, it } from 'vitest';
import { keyFundedSessionsNote, type BillingSummary } from './billing';

/**
 * The sentence under every research-session meter (org hub, billing page, research and policy pages). The meter is
 * the plan's allowance — plan-funded sessions only — so the note must name what ran on the organization's own API
 * key whenever there is anything to name, including after the key was removed mid-period, and say nothing when
 * there is not. Pure: only the two fields it reads matter, so the summary is a minimal stand-in.
 */
function summary(researchSessionsOnKey: number, keyOnFile: boolean): BillingSummary {
  return {
    usage: { researchSessions: 4, researchSessionsOnKey, portraits: 1, seats: 1 },
    apiKey: keyOnFile
      ? { provider: 'anthropic', keyHint: 'Ab12', createdBy: null, createdAt: new Date(), validatedAt: new Date() }
      : null,
  } as BillingSummary;
}

describe('keyFundedSessionsNote', () => {
  it('counts the period’s key-funded sessions, whether or not the key is still on file', () => {
    const withKey = keyFundedSessionsNote(summary(1234, true));
    expect(withKey).toBe(
      'Research sessions on the organization’s own API key do not count against the plan’s allowance ' +
        '(1,234 this period).',
    );
    // A key removed mid-period does not hand its sessions to the plan, and the note still says where they went.
    expect(keyFundedSessionsNote(summary(1234, false))).toBe(withKey);
  });

  it('explains the meter to an organization with a key on file and nothing run on it yet', () => {
    expect(keyFundedSessionsNote(summary(0, true))).toBe(
      'Research sessions on the organization’s own API key do not count against the plan’s allowance.',
    );
  });

  it('is empty when the meter is the whole story: no key on file and nothing run on one', () => {
    expect(keyFundedSessionsNote(summary(0, false))).toBe('');
  });
});
