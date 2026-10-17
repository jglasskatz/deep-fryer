import { describe, expect, it } from 'vitest';
import { waysToPay, type BuildStepFacts } from './payment-options';

/**
 * The ways to pay /start's build step offers. Building is never free, so the
 * step must always leave a way forward that this server can actually take —
 * and never offer one it cannot (a key it cannot store, a checkout it does
 * not have).
 */
const facts = (over: Partial<BuildStepFacts> = {}): BuildStepFacts => ({
  inGoodStanding: false,
  awaitingInvoicePayment: false,
  keyOnFile: false,
  onlinePayment: true,
  keysStorable: true,
  researchKeyConfigured: true,
  orgRole: 'owner',
  ...over,
});

describe('waysToPay', () => {
  it('offers a new organization a plan, a contract, and its own key', () => {
    expect(waysToPay(facts())).toEqual({
      plan: { action: 'choose', viewerCan: true },
      contract: true,
      ownKey: { viewerCan: true },
      planAloneCannotBuild: false,
    });
  });

  it('always offers a contract, even where the server takes no online payment and stores no keys', () => {
    const ways = waysToPay(facts({ onlinePayment: false, keysStorable: false }));
    expect(ways).toEqual({ plan: null, contract: true, ownKey: null, planAloneCannotBuild: false });
  });

  it('offers the organization’s own key only where this server can store one, and not twice', () => {
    expect(waysToPay(facts({ keysStorable: false })).ownKey).toBeNull();
    expect(waysToPay(facts({ keyOnFile: true })).ownKey).toBeNull();
  });

  it('lets billing contacts buy a plan but only owners add a key, and tells everyone else who can', () => {
    expect(waysToPay(facts({ orgRole: 'billing' }))).toMatchObject({
      plan: { viewerCan: true },
      ownKey: { viewerCan: false },
    });
    expect(waysToPay(facts({ orgRole: null }))).toMatchObject({
      plan: { viewerCan: false },
      ownKey: { viewerCan: false },
    });
  });

  it('offers a change of plan to an organization whose plan cannot cover the build', () => {
    expect(waysToPay(facts({ inGoodStanding: true })).plan).toEqual({ action: 'change', viewerCan: true });
  });

  it('asks an organization whose invoice plan awaits its first payment to pay it, not to choose a plan again', () => {
    expect(waysToPay(facts({ awaitingInvoicePayment: true })).plan).toEqual({ action: 'pay', viewerCan: true });
    // A contract stays on offer; buying a second plan does not.
    expect(waysToPay(facts({ awaitingInvoicePayment: true })).contract).toBe(true);
  });

  it('warns that a plan alone cannot build on a server without a research key, unless the organization’s key pays', () => {
    expect(waysToPay(facts({ researchKeyConfigured: false })).planAloneCannotBuild).toBe(true);
    expect(waysToPay(facts({ researchKeyConfigured: false, keyOnFile: true })).planAloneCannotBuild).toBe(false);
  });
});
