import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type Stripe from 'stripe';
import { PLANS, PURCHASABLE_PLANS } from '@deep-fryer/core';
import { getDb, organizationBySlug } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { PlanPicker, type PickerPlan } from '@/components/billing/PlanPicker';
import { PortalButton } from '@/components/billing/PortalButton';
import { ContractForm } from '@/components/billing/ContractForm';
import { getAuth, getOrgRole } from '@/lib/auth';
import { billingSummary, WARNING_COPY } from '@/lib/billing';
import { hasDatabase, stripeConfigured, supportEmail } from '@/lib/env';
import { catalogPrices, formatPrice, stripe } from '@/lib/stripe';

export const metadata: Metadata = { title: 'Billing', robots: { index: false } };

const COLLECTION_LABEL = {
  card: 'Card (Stripe)',
  invoice: 'Invoice, net 30 (Stripe)',
  contract: 'Contract (invoiced directly)',
} as const;

/**
 * Billing (SPEC-v4 §3): organization owners, billing contacts, and staff.
 * Shows standing and usage against the plan, the invoice history, and the
 * ways to buy — card checkout, annual invoice with PO, or (staff) a
 * negotiated contract.
 */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  if (!hasDatabase()) redirect('/');
  const { org: orgSlug } = await params;
  const { checkout } = await searchParams;
  const org = await organizationBySlug(getDb(), orgSlug);
  if (!org) notFound();
  const auth = await getAuth();
  if (!auth.userId) redirect(`/login?next=${encodeURIComponent(`/o/${orgSlug}/billing`)}`);
  const role = await getOrgRole(org.id);
  if (!role && !auth.isStaff) redirect(`/o/${orgSlug}`);

  const [summary, prices] = await Promise.all([billingSummary(org.id), catalogPrices()]);
  const sub = summary.subscription;

  let invoices: Stripe.Invoice[] = [];
  if (stripeConfigured() && org.stripeCustomerId) {
    try {
      invoices = (await stripe().invoices.list({ customer: org.stripeCustomerId, limit: 12 })).data;
    } catch (err) {
      console.error('[billing] invoice list failed', err);
    }
  }

  const pickerPlans: PickerPlan[] = PURCHASABLE_PLANS.map((id) => {
    const p = PLANS[id];
    const price = (interval: 'month' | 'year') => {
      const key = p.stripeLookupKeys[interval];
      const found = key ? prices.get(key) : undefined;
      return found ? formatPrice(found) : undefined;
    };
    return {
      id,
      name: p.name,
      audience: p.audience,
      highlights: p.highlights,
      limits: {
        portraits: p.portraits,
        seats: p.seats,
        researchSessionsPerYear: p.researchSessionsPerYear,
      },
      selfServe: p.selfServe,
      prices: { month: price('month'), year: price('year') },
    };
  });
  const stripeManaged = Boolean(
    sub?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(sub.status),
  );
  const contact = supportEmail();

  return (
    <>
      <SiteHeader variant="org" org={{ slug: org.slug, name: org.name }} />
      <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm">
          <Link className="underline" href={`/o/${org.slug}`}>
            ← {org.name}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">Billing</h1>

        {checkout === 'success' ? (
          <p role="status" className="mt-4 rounded bg-green-50 p-3 text-sm text-green-900">
            Payment received — thank you. Your plan updates here within a few seconds.
          </p>
        ) : checkout === 'canceled' ? (
          <p className="mt-4 rounded bg-black/5 p-3 text-sm">Checkout canceled; nothing was charged.</p>
        ) : null}

        <section className="mt-6 rounded-lg border border-black/10 p-4" aria-labelledby="current">
          <h2 id="current" className="text-lg font-semibold">
            {summary.plan ? `${summary.plan.name} plan` : 'No plan yet'}
          </h2>
          {sub ? (
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-[color:var(--color-muted)]">Status: </dt>
                <dd className="inline">{sub.status}{sub.cancelAtPeriodEnd ? ' (ends at period close)' : ''}</dd>
              </div>
              <div>
                <dt className="inline text-[color:var(--color-muted)]">Billing: </dt>
                <dd className="inline">{COLLECTION_LABEL[sub.collection]}</dd>
              </div>
              <div>
                <dt className="inline text-[color:var(--color-muted)]">Current period: </dt>
                <dd className="inline">
                  {sub.currentPeriodStart.toISOString().slice(0, 10)} → {sub.currentPeriodEnd.toISOString().slice(0, 10)}
                </dd>
              </div>
              {sub.poNumber ? (
                <div>
                  <dt className="inline text-[color:var(--color-muted)]">PO: </dt>
                  <dd className="inline">{sub.poNumber}</dd>
                </div>
              ) : null}
              {sub.trialEndsAt ? (
                <div>
                  <dt className="inline text-[color:var(--color-muted)]">Trial ends: </dt>
                  <dd className="inline">{sub.trialEndsAt.toISOString().slice(0, 10)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {summary.blockedMessage ? (
            <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-900">
              {summary.blockedMessage}
            </p>
          ) : summary.standing.warning ? (
            <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
              {WARNING_COPY[summary.standing.warning]}
            </p>
          ) : null}
          {summary.limits ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <UsageMeter label="Research sessions this period" used={summary.usage.researchSessions} limit={summary.limits.researchSessions} />
              <UsageMeter label="Portraits" used={summary.usage.portraits} limit={summary.limits.portraits} />
              <UsageMeter label="Seats" used={summary.usage.seats} limit={summary.limits.seats} />
            </div>
          ) : null}
          <p className="mt-3 text-xs text-[color:var(--color-muted)]">
            Allowances are hard caps — there is never an overage charge. Published portraits stay
            online whatever the billing status.
          </p>
          {stripeConfigured() && org.stripeCustomerId ? (
            <div className="mt-4">
              <PortalButton orgSlug={org.slug} />
            </div>
          ) : null}
        </section>

        {invoices.length > 0 ? (
          <section className="mt-8" aria-labelledby="invoices">
            <h2 id="invoices" className="text-lg font-semibold">
              Invoices
            </h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-[color:var(--color-muted)]">
                    <th className="py-2 pr-4 font-medium">Number</th>
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b">
                      <td className="py-2 pr-4">{inv.number ?? '—'}</td>
                      <td className="py-2 pr-4">{new Date(inv.created * 1000).toISOString().slice(0, 10)}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {(inv.amount_due / 100).toLocaleString('en-US', { style: 'currency', currency: inv.currency.toUpperCase() })}
                      </td>
                      <td className="py-2 pr-4">{inv.status}</td>
                      <td className="py-2 pr-4 text-right">
                        {inv.hosted_invoice_url ? (
                          <a className="underline" href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">
                            View / pay
                          </a>
                        ) : null}
                        {inv.invoice_pdf ? (
                          <a className="ml-3 underline" href={inv.invoice_pdf} target="_blank" rel="noreferrer">
                            PDF
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!stripeManaged ? (
          <section className="mt-10" aria-labelledby="choose">
            <h2 id="choose" className="text-lg font-semibold">
              {sub && sub.plan !== 'trial' && summary.standing.active ? 'Move to online billing' : 'Choose a plan'}
            </h2>
            {stripeConfigured() ? (
              <div className="mt-4">
                <PlanPicker
                  orgSlug={org.slug}
                  plans={pickerPlans}
                  defaultBillingEmail={org.billingEmail ?? auth.email ?? ''}
                  defaultTaxExempt={org.taxExempt}
                  currentPlan={sub?.plan ?? null}
                />
              </div>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                Online billing is not enabled on this server.{' '}
                {contact ? (
                  <>
                    Email <a className="underline" href={`mailto:${contact}`}>{contact}</a> to arrange a contract or invoice.
                  </>
                ) : (
                  'Contact the operator to arrange a contract or invoice.'
                )}
              </p>
            )}
            <p className="mt-4 text-xs text-[color:var(--color-muted)]">
              Need a quote for procurement, a W-9, or a security questionnaire?{' '}
              {contact ? <a className="underline" href={`mailto:${contact}`}>{contact}</a> : 'Contact us'}
              . See also <Link className="underline" href="/pricing">pricing</Link>.
            </p>
          </section>
        ) : null}

        {auth.isStaff ? (
          <section className="mt-10 rounded-lg border border-dashed border-black/30 p-4" aria-labelledby="staff">
            <h2 id="staff" className="text-lg font-semibold">
              Staff: contract terms
            </h2>
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
              For agreements invoiced outside Stripe (e.g. the NYC pilot). Blank limits use the
              plan&apos;s catalog values.
            </p>
            <div className="mt-3">
              <ContractForm
                orgSlug={org.slug}
                initial={{
                  plan: sub?.plan ?? 'metro',
                  periodStart: (sub?.collection === 'contract' ? sub.currentPeriodStart : new Date()).toISOString().slice(0, 10),
                  periodEnd: (sub?.currentPeriodEnd ?? new Date(Date.now() + 365 * 86_400_000)).toISOString().slice(0, 10),
                  poNumber: sub?.poNumber ?? '',
                  researchSessionsOverride: sub?.researchSessionsOverride ?? null,
                  portraitsOverride: sub?.portraitsOverride ?? null,
                  seatsOverride: sub?.seatsOverride ?? null,
                }}
              />
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
