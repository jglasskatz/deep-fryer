import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { FREE_SETUP_LIMITS, SESSIONS_PER_FULL_REFRESH } from '@deep-fryer/core';
import { organizationForTenant, researchRuns, tenantBySlug } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitForm } from '@/components/onboarding/PortraitForm';
import { BuildDoughnut } from '@/components/onboarding/BuildDoughnut';
import { howBuildingStarts, waysToPay } from '@/components/onboarding/payment-options';
import { DOUGHNUT_ROUTES, routesWithoutResearch } from '@/components/onboarding/routes';
import { LookItOver, StartStep, WhatYouHave, WithoutResearch } from '@/components/onboarding/StartSteps';
import { ResearchCostEstimate } from '@/components/billing/ResearchCostEstimate';
import { ContactText } from '@/components/billing/ContactText';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { getAuth, getOrgRole, getRole, roleAtLeast } from '@/lib/auth';
import { billingSummary, firstDoughnutRoute, previewResearchSpend, researchUnavailableNotice } from '@/lib/billing';
import { systemDb, userDb } from '@/lib/db';
import { seatsInEffect } from '@/lib/invitations';
import {
  bringYourOwnKeyAvailable,
  deploymentResearchKeyConfigured,
  hasDatabase,
  stripeConfigured,
  supportEmail,
} from '@/lib/env';
import { requireDeploymentFeature } from '@/lib/features';

export const metadata: Metadata = { title: 'Make a doughnut' };

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
 * Self-serve start (SPEC-v7 §4): "Make a doughnut for where you live", the
 * first thing a group sees after signing in, as four plain steps on one
 * page (START_STEPS):
 *
 * 1. Name the place — the city's, town's or county's name and its state or
 *    country (PortraitForm), which creates the organization and the
 *    portrait with no plan; it stays private until its first publish.
 * 2. What do you already have? — every way in from components/onboarding/
 *    routes.ts, the one list each way adds itself to.
 * 3. We make your doughnut — what the research does, then, when it can
 *    run now (previewResearchSpend), how it is paid for (a plan, a
 *    contract or, where this server can store keys, the organization's own
 *    key: payment-options.ts waysToPay, worded by lib/billing.ts
 *    firstDoughnutRoute), the estimate and "Build my doughnut". When it
 *    cannot, the step leads with every way in that needs no research, says
 *    in one sentence how building becomes available (howBuildingStarts) and
 *    folds the ways to pay and the estimate into a closed disclosure, so a
 *    group that cannot pay yet first reads what it can do today.
 * 4. Look it over together — the portrait's admin page and draft, and how
 *    many more people can be invited (lib/invitations.ts seatsInEffect, the
 *    count the invitation form applies).
 *
 * `/start` shows step one to do and the rest as what comes next;
 * `/start?portrait=<slug>` shows the same four with step one done, for an
 * editor or owner of that portrait (anyone else with a role there is told
 * who can; anyone without one gets the plain start page, which says nothing
 * about whether the portrait exists).
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
    const steps = await portraitSteps(portrait, checkout === 'success', Number(at));
    // Unknown, or a portrait this person holds no role on: the plain start page.
    if (!steps) redirect('/start');
    return <StartShell>{steps}</StartShell>;
  }

  return (
    <StartShell>
      <h1 className="text-3xl font-bold">Make a doughnut for where you live</h1>
      <p className="mt-3 text-[color:var(--color-muted)]">
        A doughnut shows, topic by topic, whether everyone in a place has what they need, and whether the place
        lives within what nature can give. Making one takes four steps. You can stop after any of them and come
        back later, and nothing is public until your group publishes it.
      </p>
      <ol className="mt-8 space-y-4">
        <StartStep index={0} state="current">
          <p className="text-sm">
            Type the name of your city, town or county and where it is. You can change the details later.
          </p>
          <div className="mt-4">
            <PortraitForm mode="start" />
          </div>
        </StartStep>
        <StartStep index={1} state="upcoming">
          <WhatYouHave routes={DOUGHNUT_ROUTES} tenantSlug={null} />
        </StartStep>
        <StartStep index={2} state="upcoming">
          <p className="text-sm">
            We look up each number from public sources and record where it came from. Once the place is named,
            this step says when the research can start.
          </p>
        </StartStep>
        <StartStep index={3} state="upcoming">
          <LookItOver tenantSlug={null} others={FREE_SETUP_LIMITS.seats - 1} />
        </StartStep>
      </ol>
    </StartShell>
  );
}

function StartShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        {children}
      </main>
    </>
  );
}

/**
 * The four steps for portrait `slug`, step one done; null when there is no
 * such portrait or the signed-in person holds no role on it. Starting
 * research and adding data need editor and up (the role applying a run
 * needs); a viewer or moderator is told so, and who can. `paid` is set when
 * a completed Stripe Checkout sent the person back — by way of the billing
 * page, which forwards here (a canceled one stays there, to choose again) —
 * and `paidAt` is when the billing page did (epoch ms; NaN if absent).
 */
async function portraitSteps(slug: string, paid: boolean, paidAt: number) {
  const tenant = await tenantBySlug(systemDb(), slug);
  if (!tenant) return null;
  const role = await getRole(tenant.id);
  if (!role) return null;
  if (!roleAtLeast(role, 'editor')) return <BelowEditor slug={tenant.slug} name={tenant.name} />;
  const org = await organizationForTenant(systemDb(), tenant.id);
  if (!org) return null;

  const [summary, orgRole, inProgress, applied] = await Promise.all([
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
    // Any applied run of this portrait: the draft doughnut page then has something to show.
    userDb((db) =>
      db
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(and(eq(researchRuns.tenantId, tenant.id), isNotNull(researchRuns.appliedAt)))
        .limit(1),
    ),
  ]);
  const seats = await seatsInEffect(systemDb(), org.id, summary.subscription);
  const sessions = SESSIONS_PER_FULL_REFRESH;
  // "Build my doughnut" plans a full build, so the deployment's first-doughnut choice applies to it.
  const preview = previewResearchSpend(summary, sessions, undefined, undefined, true);
  const route = firstDoughnutRoute({
    subscription: summary.subscription,
    researchApplied: summary.researchApplied,
    keyOnFile: summary.apiKey !== null,
  });
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
    firstOnOwnKey: route.onOwnKey,
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
  // Under the first-doughnut route, once that build is applied and still running: nothing to pay for until it ends.
  const firstUnderWay = route.firstStarted && Boolean(running);

  // Research cannot run for this group now, and none is under way or being paid for: say what can be done meanwhile.
  const withoutResearch = !preview.allowed && !running && !awaitingCheckout && !firstUnderWay;
  // Building cannot start now and nothing is under way: the step leads with what can be done instead.
  const blocked = !preview.allowed && !running;

  const checkoutLine = (
    <>
      <strong>Your card payment is being confirmed.</strong> There is nothing more to choose here: the plan appears
      above as soon as Stripe confirms it. Questions about the payment:{' '}
      <ContactText text={`${contactLine}.`} contact={contact} subject={contractSubject} />
    </>
  );

  // Who pays, the ways to pay and the estimate: open beside the button, folded while building is not available.
  const payDetails = (
    <>
      {awaitingCheckout ? (
        <p className="mt-2 text-sm">{checkoutLine}</p>
      ) : ways.keyBuildsFirst ? (
        // Before an unpaid invoice's words: the key on file pays for this build whatever the plan's state.
        <p className="mt-2 text-sm">
          <strong>Your Anthropic API key</strong> (<span className="font-mono">sk-ant-…{summary.apiKey?.keyHint}</span>){' '}
          {route.keyPaysForFirst}{' '}
          <Link className="underline" href={`${billingHref}#api-key`}>
            Manage the key
          </Link>
        </p>
      ) : firstUnderWay ? (
        <p className="mt-2 text-sm">
          <strong>{planName ? `Your ${planName} is not active.` : 'No plan yet.'}</strong> The research under way
          will finish; more research after it needs a plan or a contract.
        </p>
      ) : awaitingInvoice ? (
        <p className="mt-2 text-sm">
          <strong>Your {planName ?? 'plan'} starts once its first invoice is paid.</strong> The invoice went
          to your billing contact; it can be paid by ACH, check, or card, and{' '}
          <Link className="underline" href={`${billingHref}#invoices`}>
            the billing page
          </Link>{' '}
          lists it. {route.awaitingInvoiceBuild}
        </p>
      ) : !summary.standing.active ? (
        <p className="mt-2 text-sm">
          <strong>{planName ? `Your ${planName} is not active.` : 'No plan yet.'}</strong> {route.buildNeeds}
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

      {/* Said before anyone pays for a plan that could not build here. */}
      {planNotice ? (
        <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
          <ContactText text={planNotice} contact={contact} subject={contractSubject} />
        </p>
      ) : null}

      {awaitingCheckout || firstUnderWay ? null : !preview.allowed || (!summary.standing.active && !ways.keyBuildsFirst) ? (
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
              <strong>Use your own Anthropic API key.</strong> {route.ownKeyDoes}{' '}
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
        {/* Describes the way this step recommends: under the first-doughnut route that is the key, before one is added too. */}
        <ResearchCostEstimate sessions={sessions} onKey={onKey || route.onOwnKey} />
      </div>
    </>
  );

  return (
    <>
      <h1 className="text-3xl font-bold break-words">Make a doughnut for {tenant.name}</h1>
      <p className="mt-2 text-sm text-[color:var(--color-muted)]">Private until your group publishes it.</p>

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

      <ol className="mt-8 space-y-4">
        <StartStep index={0} state="done">
          <p className="text-sm">
            {tenant.name}
            {tenant.region ? `, ${tenant.region},` : ''} is set up.{' '}
            {role === 'owner' ? (
              <Link className="underline" href={`/${tenant.slug}/admin/settings`}>
                Change its boundary or other details in Settings
              </Link>
            ) : null}
          </p>
        </StartStep>

        <StartStep index={1} state="current">
          <WhatYouHave routes={DOUGHNUT_ROUTES} tenantSlug={tenant.slug} />
        </StartStep>

        <StartStep index={2} state="upcoming">
          <p className="text-sm text-[color:var(--color-muted)]">
            {blocked
              ? 'Research looks up each number for an overview of the place and all 21 topics, from public sources, and records where each one came from. Nothing is public until your group reviews and publishes it.'
              : 'One click plans and starts the full research: an overview of the place and all 21 topics, each number with its source. Research takes a while; the run page shows how far it has got, and nothing is public until your group reviews and publishes it.'}
          </p>

          {blocked ? (
            <>
              {/* What the group can do today comes first, then one line on how building becomes available; the
                  ways to pay and the estimate stay folded away until someone asks for them. */}
              {withoutResearch ? <WithoutResearch routes={routesWithoutResearch()} tenantSlug={tenant.slug} /> : null}
              <p className="mt-4 text-sm">
                {awaitingCheckout ? (
                  checkoutLine
                ) : (
                  howBuildingStarts({
                    reason: summary.standing.reason,
                    renewsOn: summary.subscription?.currentPeriodEnd ?? null,
                    endsAtPeriodClose: Boolean(summary.subscription?.cancelAtPeriodEnd),
                    sessionsPerPeriod: summary.limits?.researchSessions ?? null,
                    sessionsNeeded: sessions,
                    keyOnFile: summary.apiKey !== null,
                    keysStorable: bringYourOwnKeyAvailable(),
                    researchKeyConfigured: deploymentResearchKeyConfigured(),
                    firstOnOwnKey: route.onOwnKey,
                  })
                )}
              </p>
              {awaitingCheckout ? null : <PaySection folded>{payDetails}</PaySection>}
            </>
          ) : (
            <>
              <PaySection folded={false}>{payDetails}</PaySection>
              <div className="mt-4">
                {running ? (
                  <p className="text-sm">
                    Research for {tenant.name} is under way.{' '}
                    <Link className="font-medium underline" href={`/${tenant.slug}/admin/research/${running.id}`}>
                      Follow the run
                    </Link>
                  </p>
                ) : (
                  <BuildDoughnut tenantSlug={tenant.slug} />
                )}
              </div>
            </>
          )}
        </StartStep>

        <StartStep index={3} state="upcoming">
          <LookItOver
            tenantSlug={tenant.slug}
            tenantName={tenant.name}
            seats={seats}
            canInvite={role === 'owner'}
            hasDraft={applied.length > 0}
          />
        </StartStep>
      </ol>
    </>
  );
}

/**
 * The build step's "How the research is paid for": a section under its own
 * heading beside "Build my doughnut", or, while building is not available,
 * a disclosure that starts closed (`folded`), so the group reads what it can
 * do today before any plan, key or estimate. A native details element: it
 * opens with Enter or Space, and a screen reader announces it as collapsed.
 */
function PaySection({ folded, children }: { folded: boolean; children: ReactNode }) {
  if (folded) {
    return (
      <details className="mt-3 rounded-lg border border-black/15 p-4">
        <summary className="cursor-pointer font-semibold">How the research is paid for</summary>
        {children}
      </details>
    );
  }
  return (
    <section className="mt-4 rounded-lg border border-black/15 p-4" aria-labelledby="pay">
      <h3 id="pay" className="font-semibold">
        How the research is paid for
      </h3>
      {children}
    </section>
  );
}

/**
 * /start?portrait=<slug> for someone who may look at the portrait but not
 * change it (a viewer or moderator): what they can do instead of a page of
 * steps they could not take.
 */
function BelowEditor({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="break-words">
      <h1 className="text-3xl font-bold">Make a doughnut for {name}</h1>
      <p className="mt-4">
        You can look at {name}, but only its editors and owners can add to its doughnut or start research. Ask one
        of its owners to make you an editor.
      </p>
      <p className="mt-4 text-sm">
        <Link className="underline" href={`/${encodeURIComponent(slug)}/admin`}>
          Open the admin page for {name}
        </Link>
      </p>
    </div>
  );
}
