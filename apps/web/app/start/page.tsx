import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { FREE_SETUP_LIMITS, SESSIONS_PER_FULL_REFRESH } from '@deep-fryer/core';
import { organizationForTenant, researchRuns, tenantBySlug } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitForm } from '@/components/onboarding/PortraitForm';
import { BuildDoughnut } from '@/components/onboarding/BuildDoughnut';
import { waysToPay } from '@/components/onboarding/payment-options';
import { ResearchCostEstimate } from '@/components/billing/ResearchCostEstimate';
import { ContactText } from '@/components/billing/ContactText';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { getAuth, getOrgRole, getRole, roleAtLeast } from '@/lib/auth';
import { billingSummary, previewResearchSpend, researchUnavailableNotice } from '@/lib/billing';
import { systemDb, userDb } from '@/lib/db';
import {
  bringYourOwnKeyAvailable,
  deploymentResearchKeyConfigured,
  hasDatabase,
  stripeConfigured,
  supportEmail,
} from '@/lib/env';
import { requireDeploymentFeature } from '@/lib/features';

export const metadata: Metadata = { title: 'Start a portrait' };

/**
 * How long after a checkout the build step keeps checking for the plan by
 * itself. Stripe confirms a payment by webhook, usually within seconds; past
 * this the page stops polling and says what to do instead of refreshing an
 * open tab forever.
 */
const CHECKOUT_CONFIRM_MS = 2 * 60_000;

/** The heading of the plan way to pay, by what the organization has to do (payment-options.ts waysToPay). */
const PLAN_WAY_TITLE = {
  choose: 'Choose a plan.',
  change: 'Change the plan.',
  pay: 'Pay the first invoice.',
} as const;

/**
 * Self-serve start (SPEC-v7 §4), in two steps on one address. Setting up is
 * free; building is not ("No free trials for making donuts, but free to
 * view"):
 *
 * 1. `/start` — the city's name and state/country (PortraitForm), which
 *    creates the organization and the portrait, with no plan: the portrait
 *    is private until its first publish, and the organization may invite
 *    its people and change settings before paying anything.
 * 2. `/start?portrait=<slug>` — how the research is paid for: a plan
 *    (checkout on the billing page, which sends the person back here), a
 *    contract (always offered, by email), and — where this server can store
 *    keys — the organization's own Anthropic API key, which spares the
 *    plan's allowance but does not replace the plan. Then the estimate and
 *    "Build my doughnut", enabled only when the research gate would let the
 *    click through (lib/billing.ts previewResearchSpend). Skipping it leads
 *    to the portrait's admin.
 *
 * The whole page is the deployment's self_serve feature: off, it is a 404
 * (organizations are then created by staff).
 */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ portrait?: string; checkout?: string; at?: string }>;
}) {
  requireDeploymentFeature('self_serve');
  if (!hasDatabase()) redirect('/');
  const auth = await getAuth();
  const { portrait, checkout, at } = await searchParams;
  const here = portrait ? `/start?portrait=${encodeURIComponent(portrait)}` : '/start';
  if (!auth.userId) redirect(`/login?next=${encodeURIComponent(here)}`);

  if (portrait) {
    const step = await buildStep(portrait, checkout === 'success', Number(at));
    // Unknown, or not a portrait this person may research: the plain start page.
    if (!step) redirect('/start');
    return (
      <>
        <SiteHeader variant="account" />
        <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">{step}</main>
      </>
    );
  }

  const seats = FREE_SETUP_LIMITS.seats;
  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold">Start a portrait</h1>
        <p className="mt-3 text-[color:var(--color-muted)]">
          Enter a city and its state or country — that is all it takes. Setting up is free: you get a
          portrait with all 21 framework dimensions that stays private until your team publishes it,
          and you can invite up to {seats - 1} colleagues and adjust its settings before choosing a plan.
          Building the doughnut — the research behind every number — needs a plan; the next step shows
          how to pay, and{' '}
          <Link className="underline" href="/pricing">
            pricing
          </Link>{' '}
          shows what each plan costs.
        </p>
        <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded border border-black/10 p-3">
            <strong>1. Set up, free.</strong> The city&apos;s name and state or country. Boundary, data
            sources, and targets start from the framework&apos;s defaults.
          </li>
          <li className="rounded border border-black/10 p-3">
            <strong>2. Build.</strong> Choose a plan or arrange a contract, and one click starts the
            research: every number sourced, evidence captured, independently verified.
          </li>
          <li className="rounded border border-black/10 p-3">
            <strong>3. Review &amp; publish.</strong> Staff approve each dimension; then anyone can
            read the portrait, free.
          </li>
        </ol>
        <div className="mt-8 rounded-lg border border-black/15 p-5">
          <PortraitForm mode="start" defaultBillingEmail={auth.email} />
        </div>
      </main>
    </>
  );
}

/**
 * Step two for portrait `slug`, or null when there is no such portrait or
 * the signed-in person may not start research on it (editor and up — the
 * same role applying a run needs). `paid` is set when a completed Stripe
 * Checkout sent the person back — by way of the billing page, which forwards
 * here (a canceled one stays there, to choose again) — and `paidAt` is when
 * the billing page did (epoch ms; NaN if absent).
 */
async function buildStep(slug: string, paid: boolean, paidAt: number) {
  const tenant = await tenantBySlug(systemDb(), slug);
  if (!tenant) return null;
  if (!roleAtLeast(await getRole(tenant.id), 'editor')) return null;
  const org = await organizationForTenant(systemDb(), tenant.id);
  if (!org) return null;

  const [summary, orgRole, inProgress] = await Promise.all([
    billingSummary(org.id),
    getOrgRole(org.id),
    userDb((db) =>
      db
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.tenantId, tenant.id),
            or(eq(researchRuns.status, 'running'), and(eq(researchRuns.status, 'planned'), isNotNull(researchRuns.appliedAt))),
          ),
        )
        .limit(1),
    ),
  ]);
  const sessions = SESSIONS_PER_FULL_REFRESH;
  const preview = previewResearchSpend(summary, sessions);
  const onKey = preview.funding === 'organization_key';
  const billingHref = `/o/${org.slug}/billing`;
  const contact = supportEmail();
  const contractSubject = `Plan or contract for ${org.name}`;
  // A plan billed by invoice that is waiting for its first payment (core standing 'awaiting_payment').
  const awaitingInvoice = summary.standing.reason === 'awaiting_payment';
  const ways = waysToPay({
    inGoodStanding: summary.standing.active,
    awaitingInvoicePayment: awaitingInvoice,
    keyOnFile: summary.apiKey !== null,
    onlinePayment: stripeConfigured(),
    keysStorable: bringYourOwnKeyAvailable(),
    researchKeyConfigured: deploymentResearchKeyConfigured(),
    orgRole,
  });
  const planName = summary.plan ? `${summary.plan.name} plan` : null;
  const planNotice = ways.planAloneCannotBuild ? researchUnavailableNotice() : null;
  const running = inProgress[0];
  // Server time on both ends (the billing page stamped it), so a visitor's clock does not matter.
  const confirming = paid && Date.now() - paidAt < CHECKOUT_CONFIRM_MS;
  // Paid by card, and the plan not here yet: the only thing left is for Stripe's confirmation to land.
  // Nothing on the page then offers a way to pay — a second checkout would charge twice.
  const awaitingCheckout = paid && !summary.standing.active;
  const contactLine = contact ? `contact ${contact}` : 'contact whoever runs this server';

  return (
    <>
      <p className="text-sm text-[color:var(--color-muted)]">
        {tenant.name} · <span className="text-green-800">portrait created</span> · private until you publish
      </p>
      <h1 className="mt-1 text-3xl font-bold">Build the doughnut</h1>
      <p className="mt-3 text-[color:var(--color-muted)]">
        One click plans and starts the full research run: a region overview and all 21 dimensions.
        Research takes a while; the run page shows progress, and nothing is public until your team
        reviews and publishes it.
      </p>

      {paid ? (
        <>
          {/* Stripe confirms the payment by webhook, usually within seconds of the redirect: check again until
              the plan is in, for CHECKOUT_CONFIRM_MS. A sibling of the status, never in its place. */}
          <AutoRefresh everyMs={4000} active={confirming && !summary.standing.active} />
          {/* One live region for every state after checkout — confirming, active, not arrived — whose words
              change in place: a region that appears already filled is not announced, so swapping elements
              would leave "your plan is active" unsaid. */}
          <p
            role="status"
            className={`mt-6 rounded p-3 text-sm ${
              summary.standing.active || confirming ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'
            }`}
          >
            {summary.standing.active ? (
              `Payment received — thank you. Your ${planName ?? 'plan'} is active.`
            ) : confirming ? (
              'Payment received — thank you. Your plan becomes active within a few seconds; this page updates on its own.'
            ) : (
              <ContactText
                text={`Your payment went through, but the plan has not reached this organization yet. Reload this page in a minute; if it still has not arrived, ${contactLine}.`}
                contact={contact}
                subject={contractSubject}
              />
            )}
          </p>
        </>
      ) : null}

      <section className="mt-8 rounded-lg border border-black/15 p-5" aria-labelledby="pay">
        <h2 id="pay" className="text-lg font-semibold">
          How the research is paid for
        </h2>
        {awaitingCheckout ? (
          <p className="mt-2 text-sm">
            <strong>Your card payment is being confirmed.</strong> There is nothing more to choose here: the
            plan appears above as soon as Stripe confirms it. Questions about the payment:{' '}
            <ContactText text={`${contactLine}.`} contact={contact} subject={contractSubject} />
          </p>
        ) : awaitingInvoice ? (
          <p className="mt-2 text-sm">
            <strong>Your {planName ?? 'plan'} starts once its first invoice is paid.</strong> The invoice went
            to your billing contact; it can be paid by ACH, check, or card, and{' '}
            <Link className="underline" href={`${billingHref}#invoices`}>
              the billing page
            </Link>{' '}
            lists it. Building the doughnut needs a plan that has been paid for, or a contract.
          </p>
        ) : !summary.standing.active ? (
          <p className="mt-2 text-sm">
            <strong>{planName ? `Your ${planName} is not active.` : 'No plan yet.'}</strong> Setting up
            the portrait is free; building it needs a plan in good standing or a contract.
          </p>
        ) : onKey ? (
          <p className="mt-2 text-sm">
            <strong>Your Anthropic API key</strong> (<span className="font-mono">sk-ant-…{summary.apiKey?.keyHint}</span>)
            pays for the model usage: the sessions run on your key and do not count against your{' '}
            {planName ?? 'plan'}&apos;s allowance.{' '}
            <Link className="underline" href={`${billingHref}#api-key`}>
              Manage the key
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm">
            <strong>Your {planName ?? 'plan'}</strong>
            {preview.allowed
              ? ` — this uses ${sessions} of the ${preview.remaining} research sessions left this period.`
              : '.'}
          </p>
        )}

        {/* Said before anyone pays for a plan that could not build here; not repeated when it is already the
            reason under the button. */}
        {planNotice && planNotice !== preview.message ? (
          <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
            <ContactText text={planNotice} contact={contact} subject={contractSubject} />
          </p>
        ) : null}

        {awaitingCheckout ? null : !preview.allowed || !summary.standing.active ? (
          <ul className="mt-4 space-y-3 text-sm">
            {ways.plan ? (
              <li>
                <strong>{PLAN_WAY_TITLE[ways.plan.action]}</strong>{' '}
                {ways.plan.viewerCan ? (
                  ways.plan.action === 'pay' ? (
                    <>
                      <Link className="underline" href={`${billingHref}#invoices`}>
                        Open the billing page
                      </Link>{' '}
                      to see the invoice and pay it by card, or pay it by ACH or check as it says. Research
                      starts once it is paid.
                    </>
                  ) : (
                    <>
                      <Link className="underline" href={`${billingHref}#choose`}>
                        {ways.plan.action === 'choose' ? 'Choose a plan on the billing page' : 'Open the billing page'}
                      </Link>{' '}
                      — pay by card and come straight back here to build, or ask for an annual invoice with a
                      purchase order; research then starts once the invoice is paid.
                    </>
                  )
                ) : (
                  'An organization owner or billing contact can do this on the billing page.'
                )}
              </li>
            ) : null}
            <li>
              <strong>Arrange a contract.</strong> For a contract, a purchase order, or terms of your own,{' '}
              {contact ? (
                <>
                  email{' '}
                  <a className="underline" href={`mailto:${contact}?subject=${encodeURIComponent(contractSubject)}`}>
                    {contact}
                  </a>
                  .
                </>
              ) : (
                'contact whoever runs this server.'
              )}
            </li>
            {ways.ownKey ? (
              <li>
                <strong>Use your own Anthropic API key.</strong> The sessions then run on your key and do not
                use the plan&apos;s research allowance. A plan is still needed: your key pays for the model
                usage, not for hosting, review, and support.{' '}
                {ways.ownKey.viewerCan ? (
                  <Link className="underline" href={`${billingHref}#api-key`}>
                    Add your key on the billing page
                  </Link>
                ) : (
                  'An organization owner can add one on the billing page.'
                )}
              </li>
            ) : null}
          </ul>
        ) : ways.ownKey ? (
          <p className="mt-2 text-sm">
            Or run it on your own Anthropic API key, leaving the plan&apos;s allowance untouched:{' '}
            {ways.ownKey.viewerCan ? (
              <Link className="underline" href={`${billingHref}#api-key`}>
                add your key on the billing page
              </Link>
            ) : (
              'an organization owner can add one on the billing page'
            )}
            , then come back here.
          </p>
        ) : null}

        <div className="mt-4 rounded bg-black/[0.03] p-3">
          <ResearchCostEstimate sessions={sessions} onKey={onKey} />
        </div>
      </section>

      <div className="mt-8">
        {running ? (
          <p className="text-sm">
            Research for {tenant.name} is under way.{' '}
            <Link className="font-medium underline" href={`/${tenant.slug}/admin/research/${running.id}`}>
              Follow the run
            </Link>
          </p>
        ) : (
          <BuildDoughnut tenantSlug={tenant.slug} blockedReason={preview.allowed ? null : preview.message} />
        )}
        <p className="mt-6 text-sm">
          <Link className="underline" href={`/${tenant.slug}/admin?welcome=1`}>
            Not now — set up the portrait first
          </Link>
        </p>
      </div>
    </>
  );
}
