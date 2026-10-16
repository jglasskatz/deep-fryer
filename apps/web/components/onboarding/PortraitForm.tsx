'use client';

import { useState } from 'react';
import { slugify } from '@deep-fryer/core';
import { addPortrait, startTrial } from '@/lib/org-actions';
import { useAction } from '@/lib/use-action';

const field = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5 text-sm';

/**
 * The portrait-creation form, used by /start (new organization on a trial)
 * and the organization hub (another portrait in an existing family).
 *
 * Two fields are required — the city's name and its state/country (SPEC-v7
 * §4: "that is all"). Everything else is under "More options" and may stay
 * blank: the server derives the public address from the name (made unique
 * if taken), the boundary from name and region, and the organization name
 * from the city's (lib/org-actions.ts portraitSchema). A field left blank is
 * sent blank, so the server's default — not a guess made here — applies;
 * the address field shows the derived address until it is edited by hand.
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
  const [region, setRegion] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [definition, setDefinition] = useState('');
  const [population, setPopulation] = useState('');
  const [billingEmail, setBillingEmail] = useState(defaultBillingEmail ?? '');

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const common = {
          name,
          region,
          // Untouched: blank, so the server picks a free address from the name.
          slug: slugTouched ? slug : '',
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">City</span>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ithaca"
            autoComplete="address-level2"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">State / country</span>
          <input
            className={field}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="NY, USA"
            required
          />
        </label>
      </div>

      <details className="rounded border border-black/10 p-3 text-sm">
        <summary className="cursor-pointer font-medium">More options (all optional)</summary>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className="font-medium">Public address</span>
            {/* The bordered span is what reads as the field (the prefix sits inside it), so the
                input's own focus ring is off and the span draws one instead: without it this
                field would show no focus indicator at all (WCAG 2.4.7). */}
            <span className="mt-1 flex items-center rounded border border-field-border bg-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--color-accent)]">
              <span className="pl-2 text-[color:var(--color-muted)]">deep-fryer/</span>
              <input
                className="w-full bg-transparent px-1 py-1.5 outline-none"
                value={slugTouched ? slug : slugify(name)}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                pattern="[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?"
                aria-label="Portrait address"
                aria-describedby="address-help"
              />
            </span>
            <span id="address-help" className="block text-xs text-[color:var(--color-muted)]">
              Follows the city&apos;s name; if that address is taken, the state is added.
            </span>
          </label>
          <label className="block">
            <span className="font-medium">Boundary</span>
            <span className="block text-xs text-[color:var(--color-muted)]">
              The exact geography research targets. Left blank, it is the city&apos;s own legal boundary, and
              county or metro figures do not count as the city&apos;s. You can refine it later in Settings.
            </span>
            <textarea
              className={field}
              rows={2}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="The City of Ithaca municipal boundary (Tompkins County, NY)"
            />
          </label>
          <label className="block sm:w-1/2">
            <span className="font-medium">Population</span>
            <input
              className={field}
              inputMode="numeric"
              value={population}
              onChange={(e) => setPopulation(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="32000"
            />
          </label>
          {mode === 'start' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-medium">Organization</span>
                <input
                  className={field}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Left blank: named after the city"
                />
              </label>
              <label className="block">
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
        </div>
      </details>

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
