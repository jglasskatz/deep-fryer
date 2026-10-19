import type { OrgRole } from '@/lib/auth';

/**
 * The ways to pay that /start's build step offers (SPEC-v7 §4, as the owner
 * decided: "No free trials for making donuts, but free to view"). Building
 * a doughnut always needs an organization in good standing — a paid plan or
 * a contract — so the step lays out how to get there from what this server
 * can do and what the person looking may do. Pure, so the rules are tested
 * apart from the page (payment-options.test.ts).
 */
export interface BuildStepFacts {
  /** The organization has a plan in good standing (core standing().active). */
  inGoodStanding: boolean;
  /**
   * It has chosen a plan billed by invoice whose first invoice is not paid
   * yet (core standing reason 'awaiting_payment'): paying it is the way to
   * research, not choosing a plan again.
   */
  awaitingInvoicePayment: boolean;
  /** The organization's own Anthropic API key is on file. */
  keyOnFile: boolean;
  /** This server takes payment online (Stripe configured): card checkout or an annual invoice. */
  onlinePayment: boolean;
  /** This server can store organizations' own keys (DF_SECRETS_KEY set). */
  keysStorable: boolean;
  /** This server can run research on a plan (its own research key; env deploymentResearchKeyConfigured). */
  researchKeyConfigured: boolean;
  /** The viewer's organization role: owners and billing contacts buy plans, only owners add keys. */
  orgRole: OrgRole | null;
}

export interface WaysToPay {
  /**
   * Choose a plan — change it, when one is active but cannot cover the
   * build; pay its first invoice, when one billed by invoice awaits payment —
   * on the billing page, where checkout returns the person to this step. Null
   * where this server takes no online payment: then a contract is the way to
   * a plan.
   */
  plan: { action: 'choose' | 'change' | 'pay'; viewerCan: boolean } | null;
  /** Arrange a contract, a purchase order or an invoice by writing to support: always offered. */
  contract: true;
  /**
   * Add the organization's own key, which spares the plan's allowance (a plan
   * is still needed). Only where this server can store keys and none is on
   * file yet; never a dead end that ends in "not available".
   */
  ownKey: { viewerCan: boolean } | null;
  /**
   * This server cannot run research a plan pays for (no research key of its
   * own), so a plan alone will not build the doughnut here; with the
   * organization's own key it still can.
   */
  planAloneCannotBuild: boolean;
}

export function waysToPay(f: BuildStepFacts): WaysToPay {
  return {
    plan: f.onlinePayment
      ? {
          action: f.inGoodStanding ? 'change' : f.awaitingInvoicePayment ? 'pay' : 'choose',
          viewerCan: f.orgRole !== null,
        }
      : null,
    contract: true,
    ownKey: f.keysStorable && !f.keyOnFile ? { viewerCan: f.orgRole === 'owner' } : null,
    planAloneCannotBuild: !f.researchKeyConfigured && !f.keyOnFile,
  };
}
