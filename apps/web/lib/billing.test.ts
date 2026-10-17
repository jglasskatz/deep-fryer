import { describe, expect, it } from 'vitest';
import {
  apiKeyUnavailableNotice,
  assertFundingUsable,
  contactSentence,
  keyFundedSessionsNote,
  orgKeyUnreadableMessage,
  previewResearchSpend,
  researchUnavailableMessage,
  researchUnavailableNotice,
  type BillingSummary,
} from './billing';

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

describe('a key this server cannot read (DF_SECRETS_KEY unset)', () => {
  it('refuses research the gate put on the organization’s key, and only that', () => {
    expect(() => assertFundingUsable('organization_key', false, true)).toThrow(orgKeyUnreadableMessage());
    expect(() => assertFundingUsable('organization_key', true, true)).not.toThrow();
    expect(() => assertFundingUsable('plan', false, true)).not.toThrow();
  });

  it('tells the billing page not to promise the plan while a key is on file', () => {
    expect(apiKeyUnavailableNotice(true, true)).toBeNull();
    expect(apiKeyUnavailableNotice(false, true)).toBeNull();
    expect(apiKeyUnavailableNotice(false, false, 'help@example.gov')).toBe(
      'This server isn’t set up to store organization keys. Contact help@example.gov.',
    );
    const onFile = apiKeyUnavailableNotice(true, false, 'help@example.gov')!;
    expect(onFile).toMatch(/refused rather than run on your plan/);
    expect(onFile).toMatch(/remove the key/);
    expect(onFile).toMatch(/Contact help@example\.gov\.$/);
  });

  it('names no setting to the customer: the operator reads it in the log', () => {
    for (const message of [
      orgKeyUnreadableMessage('help@example.gov'),
      apiKeyUnavailableNotice(true, false, 'help@example.gov')!,
      apiKeyUnavailableNotice(false, false, null)!,
      researchUnavailableMessage(null),
      researchUnavailableNotice(null, true),
    ]) {
      expect(message).not.toMatch(/DF_|ANTHROPIC_|SUPPORT_EMAIL|docs\//);
    }
    expect(orgKeyUnreadableMessage('help@example.gov')).toMatch(/nothing was charged.*remove the key.*Contact help@example\.gov\.$/);
  });
});

describe('a deployment without a research key of its own (DF_RESEARCH_KEY_CONFIGURED not "true")', () => {
  it('refuses research the plan would pay for, in plain words with the support contact, and lets the organization key through', () => {
    expect(() => assertFundingUsable('plan', true, false)).toThrow(researchUnavailableMessage());
    expect(researchUnavailableMessage('help@example.gov')).toBe(
      "Research isn't available on this server yet — nothing was charged. Contact help@example.gov.",
    );
    expect(() => assertFundingUsable('organization_key', true, false)).not.toThrow();
    expect(() => assertFundingUsable('plan', true, true)).not.toThrow();
  });

  it('says the same before the click, and where keys can be stored, that the organization’s own key still works', () => {
    expect(researchUnavailableNotice('help@example.gov', true)).toMatch(
      /^Research on your plan isn't available on this server yet\. Contact help@example\.gov\. Research on your organization’s own Anthropic API key can run meanwhile/,
    );
    expect(researchUnavailableNotice('help@example.gov', false)).toBe(
      "Research on your plan isn't available on this server yet. Contact help@example.gov.",
    );
    expect(contactSentence(null)).toBe('Contact whoever runs this server.');
  });
});

describe('previewResearchSpend — what "Build my doughnut" would do, before the click', () => {
  const now = Date.now();
  /** A summary with a plan of `allowance` sessions in good standing (or none), and a key on file when `withKey`. */
  function planned({ allowance, withKey, plan = true }: { allowance: number; withKey: boolean; plan?: boolean }): BillingSummary {
    return {
      subscription: plan
        ? {
            plan: 'community',
            status: 'active',
            collection: 'card',
            currentPeriodStart: new Date(now - 86_400_000),
            currentPeriodEnd: new Date(now + 29 * 86_400_000),
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            researchSessionsOverride: allowance,
            portraitsOverride: null,
            seatsOverride: null,
          }
        : null,
      usage: { researchSessions: 0, researchSessionsOnKey: 0, portraits: 1, seats: 1 },
      apiKey: withKey
        ? { provider: 'anthropic', keyHint: 'Ab12', createdBy: null, createdAt: new Date(), validatedAt: new Date() }
        : null,
    } as BillingSummary;
  }

  it('enables the button only for a click the gate would let through', () => {
    expect(previewResearchSpend(planned({ allowance: 30, withKey: false }), 22, true, true)).toMatchObject({
      funding: 'plan',
      allowed: true,
      remaining: 30,
    });
    // No plan: refused whoever would pay, with the way to a plan.
    for (const withKey of [false, true]) {
      const none = previewResearchSpend(planned({ allowance: 30, withKey, plan: false }), 22, true, true);
      expect(none.allowed).toBe(false);
      expect(none.message).toMatch(/^Choose a plan to build your doughnut/);
    }
  });

  it('refuses plan-funded research on a server without a research key, and allows the same build on the organization’s key', () => {
    expect(previewResearchSpend(planned({ allowance: 30, withKey: false }), 22, true, false)).toMatchObject({
      funding: 'plan',
      allowed: false,
      message: researchUnavailableNotice(),
    });
    expect(previewResearchSpend(planned({ allowance: 30, withKey: true }), 22, true, false)).toMatchObject({
      funding: 'organization_key',
      allowed: true,
    });
    // The organization's key needs a server that can read it, research key or not.
    expect(previewResearchSpend(planned({ allowance: 30, withKey: true }), 22, false, true)).toMatchObject({
      funding: 'organization_key',
      allowed: false,
      message: orgKeyUnreadableMessage(),
    });
  });
});
