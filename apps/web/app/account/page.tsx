import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PLANS, isPlanId } from '@deep-fryer/core';
import { signIn } from '@/auth';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ProfileForm } from '@/components/account/ProfileForm';
import { DangerZone } from '@/components/account/DangerZone';
import { accountOverview } from '@/lib/account-data';
import { getAuth } from '@/lib/auth';
import { googleConfigured, hasDatabase, microsoftConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'Your account' };

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  'microsoft-entra-id': 'Microsoft',
  nodemailer: 'Email link',
};

/**
 * Account home: who you are publicly, how you sign in, and every
 * organization and portrait you hold a role on — the signed-in landing page.
 *
 * Most accounts are residents who signed in to join a discussion; they hold
 * no role anywhere. For them the page leads with the profile (the display
 * name their comments show) and frames starting a portrait as something for
 * city staff, further down (SPEC-v6 §2) — a resident should not land on
 * "start a 30-day trial" as the page's main content. Staff (anyone with an
 * organization or a portrait role) see their organizations first, as before.
 */
export default async function AccountPage() {
  if (!hasDatabase()) redirect('/');
  const ctx = await getAuth();
  if (!ctx.userId) redirect('/login?next=/account');
  const overview = await accountOverview(ctx.userId);
  if (!overview) redirect('/login?next=/account');

  async function link(provider: 'google' | 'microsoft-entra-id') {
    'use server';
    // Signing in while signed in links the new provider to this user.
    await signIn(provider, { redirectTo: '/account' });
  }

  /** Holds a role on an organization or a portrait — city staff, in practice. */
  const onATeam = overview.organizations.length > 0 || overview.portraits.length > 0;

  const linkable = [
    googleConfigured() && !overview.providers.includes('google') ? ('google' as const) : null,
    microsoftConfigured() && !overview.providers.includes('microsoft-entra-id')
      ? ('microsoft-entra-id' as const)
      : null,
  ].filter((p): p is 'google' | 'microsoft-entra-id' => p !== null);

  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">Your account</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">{overview.user.email}</p>
        {ctx.devMode ? (
          <p className="mt-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dev mode: you are the local developer account and act as owner everywhere.
          </p>
        ) : null}

        {onATeam ? (
          <section className="mt-10" aria-labelledby="orgs">
            <div className="flex items-baseline justify-between">
              <h2 id="orgs" className="text-lg font-semibold">
                Organizations
              </h2>
              <Link href="/start" className="text-sm underline">
                Start a new portrait
              </Link>
            </div>
            {overview.organizations.length === 0 ? (
              <p className="mt-3 text-sm text-[color:var(--color-muted)]">
                You do not administer an organization yet.{' '}
                <Link className="underline" href="/start">
                  Start a 30-day trial
                </Link>{' '}
                for your jurisdiction, or ask your city&apos;s portrait owner for an invitation.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {overview.organizations.map((o) => (
                  <li key={o.id} className="rounded-lg border border-black/10 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/o/${o.slug}`} className="font-semibold hover:underline">
                        {o.name}
                      </Link>
                      <span className="text-xs text-[color:var(--color-muted)]">{o.role}</span>
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                      {o.plan ? `${isPlanId(o.plan) ? PLANS[o.plan].name : o.plan} plan · ${o.status}` : 'No plan'}
                      {' · '}
                      <Link className="underline" href={`/o/${o.slug}/billing`}>
                        Billing
                      </Link>
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {o.portraits.map((p) => (
                        <li key={p.slug}>
                          <Link
                            href={`/${p.slug}/admin`}
                            className="inline-block rounded-full border border-black/15 px-2 py-0.5 hover:bg-black/5"
                          >
                            {p.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {overview.portraits.length > 0 ? (
          <section className="mt-10" aria-labelledby="portraits">
            <h2 id="portraits" className="text-lg font-semibold">
              Portraits you work on
            </h2>
            <div className="mt-3 overflow-x-auto">
<table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-[color:var(--color-muted)]">
                  <th className="py-2 pr-4 font-medium">Portrait</th>
                  <th className="py-2 pr-4 font-medium">Organization</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {overview.portraits.map((p) => (
                  <tr key={p.slug} className="border-b">
                    <td className="py-2 pr-4">
                      <Link className="underline" href={`/${p.slug}/admin`}>
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{p.organizationName}</td>
                    <td className="py-2 pr-4">{p.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          </section>
        ) : null}

        <section className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">Profile</h2>
            <div className="mt-3">
              <ProfileForm displayName={overview.user.displayName} name={overview.user.name} />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Sign-in methods</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {overview.providers.length === 0 ? (
                <li className="text-[color:var(--color-muted)]">Email link</li>
              ) : (
                overview.providers.map((p) => <li key={p}>✓ {PROVIDER_LABEL[p] ?? p}</li>)
              )}
            </ul>
            {linkable.map((p) => (
              <form key={p} action={link.bind(null, p)} className="mt-2">
                <button className="rounded border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5">
                  Link {PROVIDER_LABEL[p]}
                </button>
              </form>
            ))}
          </div>
        </section>

        {onATeam ? null : (
          // A resident's account: the same information the staff layout
          // gives in "Organizations", framed for the staff it is meant for.
          <section className="mt-10 rounded-lg border border-black/10 p-4" aria-labelledby="for-staff">
            <h2 id="for-staff" className="text-lg font-semibold">
              For city staff
            </h2>
            <p className="mt-2 text-sm text-[color:var(--color-muted)]">
              Joining a portrait&apos;s discussion needs nothing more than this account. If you work
              for a city or county, ask your portrait&apos;s owner for an invitation, or{' '}
              <Link className="underline" href="/start">
                start a 30-day trial
              </Link>{' '}
              for your jurisdiction.
            </p>
          </section>
        )}

        <section className="mt-12 border-t border-black/10 pt-8">
          <h2 className="text-lg font-semibold">Security</h2>
          <div className="mt-3">
            <DangerZone email={overview.user.email} />
          </div>
        </section>
      </main>
    </>
  );
}
