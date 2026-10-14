import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SESSIONS_PER_FULL_REFRESH, TRIAL_DAYS } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitForm } from '@/components/onboarding/PortraitForm';
import { getAuth } from '@/lib/auth';
import { hasDatabase } from '@/lib/env';

export const metadata: Metadata = { title: 'Start a portrait' };

export default async function StartPage() {
  if (!hasDatabase()) redirect('/');
  const auth = await getAuth();
  if (!auth.userId) redirect('/login?next=/start');

  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold">Start a portrait</h1>
        <p className="mt-3 text-[color:var(--color-muted)]">
          A {TRIAL_DAYS}-day trial: one portrait with all 21 framework dimensions, enough research
          for a full first pass ({SESSIONS_PER_FULL_REFRESH} sessions) and a few targeted re-runs,
          the review queue, and publishing. No card required — choose a plan, or ask for an
          invoice, before the trial ends.
        </p>
        <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded border border-black/10 p-3">
            <strong>1. Configure.</strong> Boundary, data portals, and adopted local goals as
            targets.
          </li>
          <li className="rounded border border-black/10 p-3">
            <strong>2. Research.</strong> Every number sourced, evidence captured, independently
            verified.
          </li>
          <li className="rounded border border-black/10 p-3">
            <strong>3. Review &amp; publish.</strong> Staff approve each dimension; residents see
            the result.
          </li>
        </ol>
        <div className="mt-8 rounded-lg border border-black/15 p-5">
          <PortraitForm mode="start" defaultBillingEmail={auth.email} />
        </div>
      </main>
    </>
  );
}
