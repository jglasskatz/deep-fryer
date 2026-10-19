'use client';

import { useState } from 'react';
import { setContract } from '@/lib/billing-actions';
import { CONTRACT_PLANS, type ContractPlanId } from '@deep-fryer/core';
import { useAction } from '@/lib/use-action';

/*
 * The plans offered are core CONTRACT_PLANS, the list setContract validates
 * against on the server too. Not 'trial': trials are retired — no research
 * is free — so a row that still says 'trial' is edited onto a real plan (the
 * form starts it on Metro, the NYC shape) rather than renewed.
 */

/** Staff-only contract editor (negotiated terms invoiced outside Stripe). */
export function ContractForm({
  orgSlug,
  initial,
}: {
  orgSlug: string;
  initial: {
    plan: string;
    periodStart: string;
    periodEnd: string;
    poNumber: string;
    researchSessionsOverride: number | null;
    portraitsOverride: number | null;
    seatsOverride: number | null;
  };
}) {
  const { run, pending, error } = useAction();
  const [v, setV] = useState(() => ({
    ...initial,
    plan: (CONTRACT_PLANS as readonly string[]).includes(initial.plan) ? initial.plan : 'metro',
  }));
  const num = (s: string) => (s === '' ? null : Number(s));
  const field = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1 text-sm';
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setContract({ orgSlug, ...v, plan: v.plan as ContractPlanId, poNumber: v.poNumber || undefined }));
      }}
    >
      <label className="text-sm">
        Plan
        <select className={field} value={v.plan} onChange={(e) => setV({ ...v, plan: e.target.value })}>
          {CONTRACT_PLANS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Term start
        <input type="date" className={field} value={v.periodStart} onChange={(e) => setV({ ...v, periodStart: e.target.value })} required />
      </label>
      <label className="text-sm">
        Term end
        <input type="date" className={field} value={v.periodEnd} onChange={(e) => setV({ ...v, periodEnd: e.target.value })} required />
      </label>
      <label className="text-sm">
        Research sessions (term)
        <input className={field} inputMode="numeric" placeholder="plan default" value={v.researchSessionsOverride ?? ''} onChange={(e) => setV({ ...v, researchSessionsOverride: num(e.target.value) })} />
      </label>
      <label className="text-sm">
        Portraits
        <input className={field} inputMode="numeric" placeholder="plan default" value={v.portraitsOverride ?? ''} onChange={(e) => setV({ ...v, portraitsOverride: num(e.target.value) })} />
      </label>
      <label className="text-sm">
        Seats
        <input className={field} inputMode="numeric" placeholder="plan default" value={v.seatsOverride ?? ''} onChange={(e) => setV({ ...v, seatsOverride: num(e.target.value) })} />
      </label>
      <label className="text-sm">
        PO number
        <input className={field} value={v.poNumber} maxLength={30} onChange={(e) => setV({ ...v, poNumber: e.target.value })} />
      </label>
      <div className="flex items-end gap-3 sm:col-span-2">
        <button className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={pending}>
          {pending ? 'Saving…' : 'Save contract'}
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
