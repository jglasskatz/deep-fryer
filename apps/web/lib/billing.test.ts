import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_DOUGHNUT_ADD_KEY_MESSAGE, firstDoughnutAddKeyMessage } from '@deep-fryer/db';
import {
  apiKeyUnavailableNotice,
  assertFundingUsable,
  contactSentence,
  firstDoughnutRoute,
  firstDoughnutSetting,
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

// DF_FIRST_DOUGHNUT: one named choice for how a group pays for its first doughnut, read the same by every screen.
describe('the first-doughnut choice', () => {
  const before = process.env.DF_FIRST_DOUGHNUT;
  afterEach(() => {
    if (before === undefined) delete process.env.DF_FIRST_DOUGHNUT;
    else process.env.DF_FIRST_DOUGHNUT = before;
  });
  const sub = {
    plan: 'community',
    status: 'active',
    collection: 'card',
    currentPeriodStart: new Date(Date.now() - 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    researchSessionsOverride: 30,
    portraitsOverride: null,
    seatsOverride: null,
  } as BillingSummary['subscription'];
  const fresh = (keyOnFile: boolean, researchApplied = false): BillingSummary =>
    ({
      subscription: null,
      usage: { researchSessions: 0, researchSessionsOnKey: 0, portraits: 1, seats: 1 },
      apiKey: keyOnFile
        ? { provider: 'anthropic', keyHint: 'Ab12', createdBy: null, createdAt: new Date(), validatedAt: new Date() }
        : null,
      researchApplied,
    }) as BillingSummary;

  it('is paid unless the operator chose own, and own only where this server can store keys', () => {
    delete process.env.DF_FIRST_DOUGHNUT;
    expect(firstDoughnutSetting(true)).toBe('paid');
    process.env.DF_FIRST_DOUGHNUT = 'own';
    expect(firstDoughnutSetting(true)).toBe('own');
    expect(firstDoughnutSetting(false)).toBe('paid');
    // Refused at boot in production; anywhere else read as the stricter rule.
    process.env.DF_FIRST_DOUGHNUT = 'starter';
    expect(firstDoughnutSetting(true)).toBe('paid');
  });

  it('words today’s rule under paid, and says nothing in place of the plan’s own standing', () => {
    for (const researchApplied of [false, true]) {
      const route = firstDoughnutRoute({ subscription: null, researchApplied, keyOnFile: false }, 'paid');
      expect(route).toMatchObject({ onOwnKey: false, firstStarted: false, keyPaysForFirst: null, keyLead: null, note: null });
      expect(route.buildNeeds).toBe('Setting up the portrait is free; building it needs a plan in good standing or a contract.');
      expect(route.awaitingInvoiceBuild).toBe('Building the doughnut needs a plan that has been paid for, or a contract.');
      expect(route.keyAndPlan).toMatch(/^A plan is still needed/);
    }
  });

  it('under own, offers the key for the first doughnut to an organization without standing that has not built one', () => {
    const facts = { subscription: null, researchApplied: false, keyOnFile: false };
    const route = firstDoughnutRoute(facts, 'own');
    expect(route).toMatchObject({ onOwnKey: true, firstStarted: false });
    expect(route.buildNeeds).toMatch(/first doughnut can be built on your organization’s own Anthropic API key with no plan/);
    // Something to do first, so an alert: the same refusal the research gate gives at the click.
    expect(route.note).toEqual({ text: FIRST_DOUGHNUT_ADD_KEY_MESSAGE, alert: true });
    // With the key on file, good news, said as information.
    expect(firstDoughnutRoute({ ...facts, keyOnFile: true }, 'own').note).toEqual({
      text: expect.stringMatching(/as one full build of every dimension/),
      alert: false,
    });
    // No sentence a group reads under own still says a plan is always needed.
    const texts = [
      route.buildNeeds, route.awaitingInvoiceBuild, route.ownKeyDoes, route.keyPaysForFirst, route.keyAndPlan,
      route.billingBuildNeeds, route.keyLead?.onFile, route.keyLead?.offFile, route.note?.text,
    ];
    for (const text of texts) {
      expect(text).toEqual(expect.any(String));
      expect(text).not.toMatch(/plan is still needed|needs a plan in good standing|not counted against your plan/);
    }
  });

  it('under own, treats a checkout that did not finish, an unpaid first invoice and a lapsed plan as without standing', () => {
    const facts = { researchApplied: false, keyOnFile: false };
    const withoutStanding = [
      { ...sub!, status: 'incomplete' as const },
      { ...sub!, collection: 'invoice' as const, firstInvoicePaidAt: null },
      { ...sub!, status: 'canceled' as const },
    ];
    for (const subscription of withoutStanding) {
      const route = firstDoughnutRoute({ ...facts, subscription }, 'own');
      expect(route.onOwnKey).toBe(true);
      // The plan's own reason first, then the key route.
      expect(route.note).toEqual({ text: firstDoughnutAddKeyMessage(subscription), alert: true });
      expect(route.note!.text).toMatch(/Your first doughnut can also be built on your organization’s own Anthropic API key/);
    }
    // In good standing, or a trial from before trials were retired: today's rule.
    const trial = { ...sub!, plan: 'trial', status: 'trialing' as const };
    for (const subscription of [sub, trial]) {
      expect(firstDoughnutRoute({ ...facts, subscription }, 'own')).toMatchObject({ onOwnKey: false, firstStarted: false, note: null });
    }
  });

  it('under own, once the first doughnut is started, says so in place of “choose a plan to build”, as information', () => {
    const route = firstDoughnutRoute({ subscription: null, researchApplied: true, keyOnFile: true }, 'own');
    expect(route).toMatchObject({ onOwnKey: false, firstStarted: true, keyPaysForFirst: null });
    expect(route.note).toEqual({
      text: 'Your first doughnut has been started. More research after it needs a plan or a contract: choose a plan under Billing, or ask us for a contract.',
      alert: false,
    });
    // A lapsed plan speaks for itself (its standing message), as under paid.
    expect(firstDoughnutRoute({ subscription: { ...sub!, status: 'canceled' }, researchApplied: true, keyOnFile: true }, 'own')).toMatchObject({
      firstStarted: true,
      note: null,
    });
  });

  it('previews a first full build on the key as the gate decides it, and nothing else', () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    expect(previewResearchSpend(fresh(true), 22, true, true, true)).toMatchObject({ funding: 'organization_key', allowed: true });
    expect(previewResearchSpend(fresh(false), 22, true, true, true)).toMatchObject({
      allowed: false,
      message: FIRST_DOUGHNUT_ADD_KEY_MESSAGE,
    });
    // Not a full build (a policy analysis, say), or a second build: refused as before.
    for (const preview of [previewResearchSpend(fresh(true), 1, true, true), previewResearchSpend(fresh(true, true), 22, true, true, true)]) {
      expect(preview.allowed).toBe(false);
      expect(preview.message).toMatch(/^Choose a plan to build your doughnut/);
    }
    // Unset: the first full build is refused too.
    delete process.env.DF_FIRST_DOUGHNUT;
    expect(previewResearchSpend(fresh(true), 22, true, true, true).message).toMatch(/^Choose a plan to build your doughnut/);
  });
});
