import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { familyByOrgSlug } from '@/lib/family';
import { organizationFeatures } from '@/lib/features';
import { hasDatabase } from '@/lib/env';

/**
 * Product landing. Public-plane rule (SPEC §10) applies to portraits, not
 * this page — but the pitch here is the same one cities hear: sourced,
 * reviewed, accountable numbers, not "AI".
 */
export default async function HomePage() {
  const nyc = hasDatabase() ? await familyByOrgSlug('nyc') : null;
  const showcase = nyc && nyc.members.length > 1 ? nyc : null;
  // The showcase opens on the family compare when NYC has it on (SPEC-v7 §3),
  // otherwise on the city's own portrait — never on a page that would 404.
  const showcaseHref = showcase
    ? (await organizationFeatures(showcase.organization.id)).family_compare
      ? `/o/${showcase.organization.slug}/compare`
      : `/${showcase.whole ?? showcase.members[0]!.slug}`
    : null;

  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main">
        <section className="mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Know where your city stands — and whether it&apos;s on track.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[color:var(--color-muted)]">
            deep-fryer builds and maintains a Doughnut Economics portrait of your jurisdiction:
            the social foundation residents should never fall below, the ecological ceiling the
            city should not overshoot, every number sourced with the evidence beside it, and
            progress measured against the goals your council already adopted.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/start"
              className="rounded bg-[color:var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Start a 30-day trial
            </Link>
            <Link
              href={showcaseHref ?? '/santacruz'}
              className="rounded border border-black/20 px-5 py-2.5 text-sm font-medium hover:bg-black/5"
            >
              {showcase ? `See ${showcase.organization.name}` : 'View the demo portrait'}
            </Link>
          </div>
        </section>

        <section className="border-t border-black/10 bg-white/50">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
            <div>
              <h2 className="font-semibold">Research you can audit</h2>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                Sources are exhausted in your priority order, each page is captured at retrieval,
                and every figure is independently re-checked against its source before staff see
                it. Data gaps are reported honestly, never filled with guesses.
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Your staff decide what&apos;s published</h2>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                A review queue shows the worked scoring math and evidence for every proposed value.
                Nothing reaches the public without a named person approving it, and every version
                is kept — the record a records request needs.
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Progress against adopted law</h2>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                Targets come from your own plans and local laws, with their due dates. Each
                refresh shows which indicators are on track, which are slipping, and the pace
                still required.
              </p>
            </div>
          </div>
        </section>

        {showcase ? (
          <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <h2 className="text-2xl font-semibold">{showcase.organization.name}</h2>
            <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted)]">
              {showcase.members.length} portraits measured against identical thresholds —
              the whole city and each {showcase.noun} — so differences between neighborhoods are
              visible instead of averaged away.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2 text-sm">
              {showcase.members.map((m) => (
                <li key={m.slug}>
                  <Link className="inline-block rounded-full border border-black/15 px-3 py-1 hover:bg-black/5" href={`/${m.slug}`}>
                    {m.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link className="inline-block rounded-full bg-black px-3 py-1 text-white" href={`/o/${showcase.organization.slug}/progress`}>
                  Progress since the baseline →
                </Link>
              </li>
            </ul>
          </section>
        ) : null}

        <footer className="border-t border-black/10">
          <div className="mx-auto flex max-w-5xl flex-wrap gap-4 px-4 py-6 text-xs text-[color:var(--color-muted)] sm:px-6">
            <Link href="/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link href="/login" className="hover:underline">
              Sign in
            </Link>
            <span>Portraits follow the Doughnut Economics Action Lab city-portrait methodology.</span>
          </div>
        </footer>
      </main>
    </>
  );
}
