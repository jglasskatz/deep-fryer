'use client';

import { useState } from 'react';
import { requestInvoiceBilling, startCheckout } from '@/lib/billing-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

export interface PickerPlan {
  id: string;
  name: string;
  audience: string;
  highlights: string[];
  limits: { portraits: number; seats: number; researchSessionsPerYear: number };
  selfServe: boolean;
  prices: { month?: string; year?: string };
}

/**
 * Plan selection with the two ways cities pay: a card now (Stripe Checkout,
 * self-serve plans), or an annual invoice to accounts payable with a PO
 * number and net-30 terms (any purchasable plan).
 */
export function PlanPicker({
  orgSlug,
  plans,
  defaultBillingEmail,
  defaultTaxExempt,
  currentPlan,
}: {
  orgSlug: string;
  plans: PickerPlan[];
  defaultBillingEmail: string;
  defaultTaxExempt: boolean;
  currentPlan: string | null;
}) {
  const { run, pending, error } = useAction();
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const [invoicePlan, setInvoicePlan] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultBillingEmail);
  const [po, setPo] = useState('');
  const [exempt, setExempt] = useState(defaultTaxExempt);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div>
      <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded border border-black/15 p-0.5 text-sm">
        {(['year', 'month'] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={interval === i}
            onClick={() => setInterval(i)}
            className={`rounded px-3 py-1 ${interval === i ? 'bg-black text-white' : ''}`}
          >
            {i === 'year' ? 'Annual' : 'Monthly'}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const price = p.prices[interval];
          const current = currentPlan === p.id;
          return (
            <div key={p.id} className={`flex flex-col rounded-lg border p-4 ${current ? 'border-[color:var(--color-accent)]' : 'border-black/15'}`}>
              <h3 className="text-lg font-semibold">
                {p.name}
                {current ? <span className="ml-2 text-xs font-normal text-[color:var(--color-accent)]">current</span> : null}
              </h3>
              <p className="mt-1 text-xs text-[color:var(--color-muted)]">{p.audience}</p>
              <p className="mt-3 text-xl font-bold">
                {price ?? (interval === 'month' && !p.prices.month && p.prices.year ? 'Annual only' : 'Contact us')}
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-sm">
                <li>
                  {p.limits.portraits} portrait{p.limits.portraits === 1 ? '' : 's'} · {p.limits.seats} seats
                </li>
                <li>{p.limits.researchSessionsPerYear.toLocaleString()} research sessions / year</li>
                {p.highlights.map((h) => (
                  <li key={h} className="text-[color:var(--color-muted)]">
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-2">
                {p.selfServe && price ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="w-full rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    onClick={() =>
                      run(
                        async () => {
                          const { url } = unwrap(await startCheckout({ orgSlug, plan: p.id, interval }));
                          window.location.assign(url);
                        },
                        { refresh: false },
                      )
                    }
                  >
                    Pay by card
                  </button>
                ) : null}
                {p.prices.year ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="w-full rounded border border-black/20 px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
                    onClick={() => setInvoicePlan(invoicePlan === p.id ? null : p.id)}
                    aria-expanded={invoicePlan === p.id}
                  >
                    Request an annual invoice
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {invoicePlan ? (
        <form
          className="mt-6 rounded-lg border border-black/15 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await requestInvoiceBilling({
                orgSlug,
                plan: invoicePlan,
                billingEmail: email,
                poNumber: po || undefined,
                taxExempt: exempt,
              });
              if (r.ok) {
                setDone(`Subscribed to ${plans.find((p) => p.id === invoicePlan)?.name}. The first invoice is on its way to ${email} (net 30).`);
                setInvoicePlan(null);
              }
              return r;
            });
          }}
        >
          <h3 className="text-base font-semibold">
            Annual invoice — {plans.find((p) => p.id === invoicePlan)?.name}
          </h3>
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            Service starts now. The invoice goes to accounts payable with net-30 terms and can be
            paid by ACH, check, or card. Research continues while an invoice is past due.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Invoice email</span>
              <input
                type="email"
                required
                className="mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">PO number (optional)</span>
              <input
                className="mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5"
                value={po}
                maxLength={30}
                onChange={(e) => setPo(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
            We are a tax-exempt government entity
          </label>
          <button
            className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
          >
            {pending ? 'Setting up…' : 'Start subscription and send invoice'}
          </button>
        </form>
      ) : null}

      {done ? (
        <p role="status" className="mt-4 rounded bg-green-50 p-3 text-sm text-green-900">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
