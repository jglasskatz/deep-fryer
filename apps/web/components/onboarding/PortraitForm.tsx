'use client';

import { useState } from 'react';
import { slugify } from '@deep-fryer/core';
import { addPortrait, startTrial } from '@/lib/org-actions';
import { useAction } from '@/lib/use-action';

const field = 'mt-1 w-full rounded border border-black/20 bg-white px-2 py-1.5 text-sm';

/**
 * The portrait-creation form, used by /start (new organization on a trial)
 * and the organization hub (another portrait in an existing family). The
 * address auto-follows the name until edited by hand.
 */
export function PortraitForm({
  mode,
  orgSlug,
  defaultBillingEmail,
}: {
  mode: 'start' | 'add';
  orgSlug?: string;
  defaultBillingEmail?: string | null;
}) {
  const { run, pending, error } = useAction();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgTouched, setOrgTouched] = useState(false);
  const [region, setRegion] = useState('');
  const [definition, setDefinition] = useState('');
  const [population, setPopulation] = useState('');
  const [billingEmail, setBillingEmail] = useState(defaultBillingEmail ?? '');

  const onName = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
    if (!orgTouched) setOrgName(v ? (/^(city|town|county|village|borough)\b/i.test(v) ? v : `City of ${v}`) : '');
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const common = {
          name,
          slug,
          region,
          definition,
          population: population ? Number(population) : undefined,
        };
        run(() =>
          mode === 'start'
            ? startTrial({ ...common, organizationName: orgName, billingEmail })
            : addPortrait({ ...common, orgSlug: orgSlug! }),
        );
      }}
    >
      <label className="block text-sm">
        <span className="font-medium">Jurisdiction</span>
        <input className={field} value={name} onChange={(e) => onName(e.target.value)} placeholder="Ithaca" required />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Public address</span>
        <span className="mt-1 flex items-center rounded border border-black/20 bg-white text-sm">
          <span className="pl-2 text-[color:var(--color-muted)]">deep-fryer/</span>
          <input
            className="w-full bg-transparent px-1 py-1.5 outline-none"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            pattern="[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?"
            required
            aria-label="Portrait address"
          />
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">State / country</span>
          <input className={field} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="NY, USA" required />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Population (optional)</span>
          <input
            className={field}
            inputMode="numeric"
            value={population}
            onChange={(e) => setPopulation(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="32000"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium">Boundary</span>
        <span className="block text-xs text-[color:var(--color-muted)]">
          The exact geography research targets. Precision here is what keeps county or metro data
          from passing as city data.
        </span>
        <textarea
          className={field}
          rows={2}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="The City of Ithaca municipal boundary (Tompkins County, NY)"
          required
        />
      </label>
      {mode === 'start' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Organization</span>
            <input
              className={field}
              value={orgName}
              onChange={(e) => {
                setOrgTouched(true);
                setOrgName(e.target.value);
              }}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Billing email</span>
            <input
              className={field}
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="accounts-payable@cityofexample.gov"
            />
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending}
      >
        {pending ? 'Creating…' : mode === 'start' ? 'Start 30-day trial' : 'Add portrait'}
      </button>
    </form>
  );
}
