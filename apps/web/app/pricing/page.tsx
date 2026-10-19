import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANS, PURCHASABLE_PLANS, SESSIONS_PER_FULL_REFRESH, sellsInterval } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { supportEmail } from '@/lib/env';
import { deploymentFeatureOn } from '@/lib/features';
import { catalogPrices, formatPrice } from '@/lib/stripe';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Plans for towns, cities, and multi-borough jurisdictions. Hard research allowances, never overage charges; pay by card or annual invoice with a PO.',
};

/**
 * Public pricing. Amounts come from Stripe by lookup key, so this page always
 * shows what checkout will charge; without Stripe it says "contact us"
 * rather than inventing numbers.
 *
 * There is no trial to offer ("No free trials for making donuts, but free to
 * view"): what is free is setting up a portrait and reading published ones,
 * and every plan pays for its research. Each plan's call to action starts a
 * portrait at /start when the deployment offers self-serve start, and is an
 * email to support when it does not (a sales-led deployment), so no button
 * leads to a page that does not exist.
 */
export default async function PricingPage() {
  const prices = await catalogPrices();
  const contact = supportEmail();
  const selfServe = deploymentFeatureOn('self_serve');
  // Only the intervals each plan is sold by (core sellsInterval): not Community by the month, whose
  // allowance could never build the doughnut the plan is bought for.
  const price = (id: (typeof PURCHASABLE_PLANS)[number], interval: 'month' | 'year') => {
    if (!sellsInterval(PLANS[id], interval)) return null;
    const key = PLANS[id].stripeLookupKeys[interval];
    const p = key ? prices.get(key) : undefined;
    return p ? formatPrice(p) : null;
  };

  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-3 max-w-2xl text-[color:var(--color-muted)]">
          Every plan includes the public portrait, evidence beside every number, progress against
          your adopted goals, the review queue, discussion boards, and the embed widget. Plans
          differ in portraits, seats, and research allowance. A full refresh of one portrait is{' '}
          {SESSIONS_PER_FULL_REFRESH} research sessions.
        </p>
        <p className="mt-3 max-w-2xl text-[color:var(--color-muted)]">
          Reading published portraits is always free, for everyone. Setting up a portrait is free too —
          it stays private until your team publishes it; building it, the research behind every number,
          needs a plan or a contract.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PURCHASABLE_PLANS.map((id) => {
            const p = PLANS[id];
            const annual = price(id, 'year');
            const monthly = price(id, 'month');
            return (
              <section key={id} className="flex flex-col rounded-xl border border-black/15 bg-white/60 p-6" aria-labelledby={`plan-${id}`}>
                <h2 id={`plan-${id}`} className="text-xl font-semibold">
                  {p.name}
                </h2>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">{p.audience}</p>
                <p className="mt-4 text-2xl font-bold">{annual ?? monthly ?? 'Contact us'}</p>
                {annual && monthly ? (
                  <p className="text-xs text-[color:var(--color-muted)]">or {monthly}</p>
                ) : null}
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  <li>
                    <strong>{p.portraits}</strong> portrait{p.portraits === 1 ? '' : 's'} ·{' '}
                    <strong>{p.seats}</strong> staff seats
                  </li>
                  <li>
                    <strong>{p.researchSessionsPerYear.toLocaleString()}</strong> research sessions a
                    year (~{Math.floor(p.researchSessionsPerYear / (SESSIONS_PER_FULL_REFRESH * p.portraits))}{' '}
                    full refreshes of every portrait)
                  </li>
                  {p.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                {selfServe ? (
                  <Link
                    href="/start"
                    className="mt-6 rounded bg-[color:var(--color-accent)] px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90"
                  >
                    Start a portrait
                  </Link>
                ) : contact ? (
                  <a
                    href={`mailto:${contact}?subject=${encodeURIComponent(`${p.name} plan`)}`}
                    className="mt-6 rounded border border-black/20 px-4 py-2 text-center text-sm font-medium hover:bg-black/5"
                  >
                    Contact us
                  </a>
                ) : null}
              </section>
            );
          })}
        </div>

        <section className="mt-12 grid gap-8 md:grid-cols-2" aria-label="Buying for a government">
          <div>
            <h2 className="text-lg font-semibold">Built for how governments buy</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
              <li>Annual invoices to accounts payable, net-30, with your PO number on every invoice.</li>
              <li>Tax-exempt billing for government entities.</li>
              <li>Pay by ACH, check, or card — or a negotiated contract for multi-year terms.</li>
              <li>
                Hard allowances, never overage charges: a not-to-exceed amount your appropriation
                can rely on.
              </li>
              <li>A late payment never takes a published portrait offline.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-lg font-semibold">{PLANS.enterprise.name}</h2>
            <p className="mt-2 text-sm text-[color:var(--color-muted)]">{PLANS.enterprise.audience}</p>
            <p className="mt-2 text-sm">
              Custom portrait counts and research allowances, multi-year terms, and named support.{' '}
              {contact ? (
                <a className="underline" href={`mailto:${contact}?subject=Enterprise%20inquiry`}>
                  {contact}
                </a>
              ) : null}
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
