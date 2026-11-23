import type { StandingReason } from '@deep-fryer/core';
import type { OrgRole } from '@/lib/auth';

/**
 * The ways to pay that /start's build step offers (SPEC-v7 §4, as the owner
 * decided: "No free trials for making donuts, but free to view"). Building
 * a doughnut needs an organization in good standing — a paid plan or a
 * contract — unless the deployment lets a group's own key pay for its first
 * doughnut (DF_FIRST_DOUGHNUT=own), so the step lays out how to get there
 * from what this server can do and what the person looking may do. Pure,
 * so the rules are tested apart from the page (payment-options.test.ts).
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
  /**
   * This deployment lets the organization's own key pay for its first
   * doughnut with no plan, and that first doughnut is still to come
   * (lib/billing.ts firstDoughnutRoute onOwnKey). False by default: today a
   * plan is always needed.
   */
  firstOnOwnKey?: boolean;
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
   * is still needed, unless `noPlanNeeded`: the deployment lets the key pay
   * for the first doughnut on its own). Only where this server can store keys
   * and none is on file yet; never a dead end that ends in "not available".
   */
  ownKey: { viewerCan: boolean; noPlanNeeded: boolean } | null;
  /**
   * The key on file pays for the first doughnut with no plan: nothing else
   * has to be chosen before building.
   */
  keyBuildsFirst: boolean;
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
    ownKey:
      f.keysStorable && !f.keyOnFile ? { viewerCan: f.orgRole === 'owner', noPlanNeeded: Boolean(f.firstOnOwnKey) } : null,
    keyBuildsFirst: Boolean(f.firstOnOwnKey) && f.keyOnFile,
    planAloneCannotBuild: !f.researchKeyConfigured && !f.keyOnFile,
  };
}

/** What the build step knows when building is not available yet, to say how it becomes so (howBuildingStarts). */
export interface BuildBlockedFacts {
  /** The plan's standing (core standing().reason): 'ok' for a plan in good standing. */
  reason: StandingReason;
  /** When the plan's billing period ends and its research sessions renew; null without a plan. */
  renewsOn: Date | null;
  /** The plan ends at the close of this period instead of renewing (Stripe's cancel at period end). */
  endsAtPeriodClose: boolean;
  /**
   * How many research sessions the plan allows in one billing period, contract
   * overrides included (the summary's limits); null without a plan.
   */
  sessionsPerPeriod: number | null;
  /** How many research sessions the build asks for. */
  sessionsNeeded: number;
  keyOnFile: boolean;
  /** This server can store and read organizations' own keys. */
  keysStorable: boolean;
  /** This server can run research a plan pays for. */
  researchKeyConfigured: boolean;
  /** The deployment lets the organization's own key pay for its first doughnut, still to come. */
  firstOnOwnKey: boolean;
}

/** After "once": what puts a plan that is not in good standing right, by its standing. */
const PLAN_PUT_RIGHT: Record<Exclude<StandingReason, 'ok'>, string> = {
  no_subscription: 'your organization has a plan or a contract',
  trial_expired: 'your organization has a plan or a contract',
  canceled: 'your organization has a plan or a contract',
  period_ended: 'your organization has a plan or a contract',
  awaiting_payment: 'your plan’s first invoice is paid',
  incomplete: 'your plan’s payment is completed under Billing',
  unpaid: 'the unpaid invoice is settled under Billing',
  billing_out_of_date: 'your plan is brought up to date under Billing',
};

const ADD_KEY = 'an organization owner adds your own Anthropic API key under Billing';

/**
 * The one sentence the build step shows while "Build my doughnut" cannot
 * run: how building becomes available, from the same facts the research
 * gate decides on (packages/db decideResearchSpend, then the server checks
 * of lib/billing.ts previewResearchSpend). It names every way that would
 * work, in plain words and without amounts; the details of each way stay
 * under "How the research is paid for". Pure, so each case is tested apart
 * from the page.
 */
export function howBuildingStarts(f: BuildBlockedFacts): string {
  const ways: string[] = [];
  let firstOnKey = false;
  if (f.reason === 'ok') {
    // The plan is in good standing, so the refusal is the server's or the allowance's.
    if (f.keyOnFile && !f.keysStorable) {
      return 'Research can start once an organization owner removes the key on file under Billing, or once this server is set up to use it.';
    }
    if (!f.researchKeyConfigured && !f.keyOnFile) {
      ways.push('whoever runs this server sets it up');
    } else {
      // A renewal only helps when the plan renews at all and one period's allowance covers the whole build;
      // a small contract allowance, or a short legacy period, never would.
      const renewalCovers =
        !f.endsAtPeriodClose && f.sessionsPerPeriod !== null && f.sessionsPerPeriod >= f.sessionsNeeded;
      if (renewalCovers) {
        ways.push(
          f.renewsOn
            ? `your plan’s research sessions renew on ${f.renewsOn.toISOString().slice(0, 10)}`
            : 'your plan’s research sessions renew',
        );
      }
      // Said without naming where: a larger plan is bought under Billing only where this server takes payment
      // online, while a contract is always on offer; the folded details list both.
      ways.push('your organization moves to a larger plan or contract');
    }
    // With a plan in good standing, research on the organization's own key runs whatever the allowance.
    if (f.keysStorable && !f.keyOnFile) ways.push(ADD_KEY);
  } else {
    const plan = PLAN_PUT_RIGHT[f.reason];
    ways.push(f.researchKeyConfigured || f.keyOnFile ? plan : `${plan} and whoever runs this server sets research up`);
    firstOnKey = f.firstOnOwnKey && !f.keyOnFile;
  }
  const [first, ...rest] = ways;
  return (
    `Research can start once ${first}` +
    rest.map((way) => `, or once ${way}`).join('') +
    (firstOnKey ? `, or, for your first doughnut, once ${ADD_KEY}` : '') +
    '.'
  );
}
