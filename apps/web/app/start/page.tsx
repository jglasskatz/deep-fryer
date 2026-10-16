import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { SESSIONS_PER_FULL_REFRESH, TRIAL_DAYS } from '@deep-fryer/core';
import { organizationForTenant, researchRuns, tenantBySlug } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitForm } from '@/components/onboarding/PortraitForm';
import { BuildDoughnut } from '@/components/onboarding/BuildDoughnut';
import { ResearchCostEstimate } from '@/components/billing/ResearchCostEstimate';
import { getAuth, getOrgRole, getRole, roleAtLeast } from '@/lib/auth';
import { billingSummary, previewResearchSpend } from '@/lib/billing';
import { systemDb, userDb } from '@/lib/db';
import { hasDatabase } from '@/lib/env';

export const metadata: Metadata = { title: 'Start a portrait' };

/**
 * Self-serve start (SPEC-v7 §4), in two steps on one address:
 *
 * 1. `/start` — the city's name and state/country (PortraitForm), which
 *    creates the organization, its trial, and the portrait.
 * 2. `/start?portrait=<slug>` — how the research is paid for (the
 *    organization's own Anthropic API key when one is on file, otherwise the
 *    trial's or plan's allowance), the estimate, and "Build my doughnut",
 *    which plans and starts the full run in one click. Skipping it leads to
 *    the portrait's admin, as the trial path always has.
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ portrait?: string }> }) {
  if (!hasDatabase()) redirect('/');
  const auth = await getAuth();
  const { portrait } = await searchParams;
  const here = portrait ? `/start?portrait=${encodeURIComponent(portrait)}` : '/start';
  if (!auth.userId) redirect(`/login?next=${encodeURIComponent(here)}`);

  if (portrait) {
    const step = await buildStep(portrait);
    // Unknown, or not a portrait this person may research: the plain start page.
    if (!step) redirect('/start');
    return (
      <>
        <SiteHeader variant="account" />
        <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">{step}</main>
      </>
    );
  }

  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold">Start a portrait</h1>
        <p className="mt-3 text-[color:var(--color-muted)]">
          Enter a city and its state or country — that is all it takes. You get a {TRIAL_DAYS}-day
          trial: one portrait with all 21 framework dimensions, enough research for a full first pass
          ({SESSIONS_PER_FULL_REFRESH} sessions) and a few targeted re-runs, the review queue, and
          publishing. No card required. You can also run the research on your own Anthropic API key.
        </p>
        <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded border border-black/10 p-3">
            <strong>1. Start.</strong> The city&apos;s name and state or country. Boundary, data
            sources, and targets start from the framework&apos;s defaults.
          </li>
          <li className="rounded border border-black/10 p-3">
            <strong>2. Research.</strong> On your trial or your own API key: every number sourced,
            evidence captured, independently verified.
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

/**
 * Step two for portrait `slug`, or null when there is no such portrait or
 * the signed-in person may not start research on it (editor and up — the
 * same role applying a run needs).
 */
async function buildStep(slug: string) {
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
  const allowanceName = summary.plan ? (summary.plan.id === 'trial' ? 'your trial' : `your ${summary.plan.name} plan`) : 'a plan';
  const running = inProgress[0];

  return (
    <>
      <p className="text-sm text-[color:var(--color-muted)]">
        {tenant.name} · <span className="text-green-800">portrait created</span>
      </p>
      <h1 className="mt-1 text-3xl font-bold">Build the doughnut</h1>
      <p className="mt-3 text-[color:var(--color-muted)]">
        One click plans and starts the full research run: a region overview and all 21 dimensions.
        Research takes a while; the run page shows progress, and nothing is public until your team
        reviews and publishes it.
      </p>

      <section className="mt-8 rounded-lg border border-black/15 p-5" aria-labelledby="pay">
        <h2 id="pay" className="text-lg font-semibold">
          How the research is paid for
        </h2>
        {onKey ? (
          <p className="mt-2 text-sm">
            <strong>Your Anthropic API key</strong> (<span className="font-mono">sk-ant-…{summary.apiKey?.keyHint}</span>).
            The sessions run on your key and are not counted against {allowanceName}.{' '}
            <Link className="underline" href={`${billingHref}#api-key`}>
              Manage the key
            </Link>
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              <strong>{summary.plan ? (summary.plan.id === 'trial' ? 'Your trial' : `Your ${summary.plan.name} plan`) : 'No plan yet'}</strong>
              {preview.allowed
                ? ` — this uses ${sessions} of the ${preview.remaining} research sessions left${summary.plan?.id === 'trial' ? ' in your trial' : ' this period'}; the API usage is included.`
                : '.'}
            </p>
            <p className="mt-2 text-sm">
              Or run it on your own Anthropic API key, leaving the allowance untouched:{' '}
              {orgRole === 'owner' ? (
                <Link className="underline" href={`${billingHref}#api-key`}>
                  add your key on the billing page
                </Link>
              ) : (
                'an organization owner can add one on the billing page'
              )}
              , then come back here.
              {!preview.allowed && orgRole ? (
                <>
                  {' '}
                  Or{' '}
                  <Link className="underline" href={billingHref}>
                    choose a plan
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </>
        )}
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
