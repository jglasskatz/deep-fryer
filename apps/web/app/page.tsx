import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { hasDatabase, publicPortraits, type PublicPortraitSummary } from '@/lib/data';
import { deploymentFeatureOn, portraitFeatures } from '@/lib/features';
import { mockPortrait } from '@/lib/mock-data';
import { showcaseOrgSlug } from '@/lib/site-settings';

export const metadata: Metadata = {
  description:
    'Sourced, reviewed city portraits on Kate Raworth’s Doughnut of social and planetary boundaries: every number with its evidence, progress against adopted goals, free for anyone to read.',
};

/** The organization the landing page features, from what is public in it — or null. */
interface Showcase {
  organization: { slug: string; name: string };
  members: PublicPortraitSummary[];
  /** Where "See …" goes: the family compare, or a portrait — always a page that exists for everyone. */
  href: string;
}

/**
 * The showcase (DF_SHOWCASE_ORG): shown only when that organization has at
 * least one public portrait, and built only from public portraits, so every
 * link on it opens for a signed-out visitor. It opens on the family compare
 * when two or more of them are public and one has the compare turned on —
 * the same test the compare page applies for a visitor (SPEC-v7 §3) —
 * otherwise on the whole-jurisdiction portrait (the member sharing the
 * organization's slug) or the first one.
 */
async function showcaseFor(slug: string | null): Promise<Showcase | null> {
  if (!slug) return null;
  const members = await publicPortraits(slug);
  if (members.length === 0) return null;
  const organization = members[0]!.organization;
  const compare =
    members.length > 1 &&
    (await Promise.all(members.map((m) => portraitFeatures(m.slug)))).some((f) => f.family_compare);
  const whole = members.find((m) => m.slug === organization.slug) ?? members[0]!;
  return { organization, members, href: compare ? `/o/${organization.slug}/compare` : `/${whole.slug}` };
}

/**
 * Product landing. Reading is free and open to everyone: the landing page
 * leads to every public portrait on this deployment. Building one is paid
 * (a plan, or an operator-set contract), so the call to action is to build
 * your city's doughnut — shown only while self-serve start is on (the
 * deployment's self_serve feature; off, /start is a 404 and nothing invites
 * a visitor to it) and never promising a free trial.
 *
 * Every link here opens for a signed-out visitor: the portrait lists come
 * from lib/data.ts publicPortraits (published portraits only, the same for
 * every reader, so a member never sees their private portrait listed and a
 * cached copy never shows one), and without a database the one link is the
 * bundled demo portrait, which is what /{slug} serves then.
 */
export default async function HomePage() {
  const selfServe = deploymentFeatureOn('self_serve');
  const showcase = await showcaseFor(showcaseOrgSlug());
  const listed = (await publicPortraits()).filter((p) => p.organization.slug !== showcase?.organization.slug);
  const demo = hasDatabase() ? null : mockPortrait.tenant;

  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main">
        <section className="mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Know where your city stands — and whether it&apos;s on track.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[color:var(--color-muted)]">
            deep-fryer builds and maintains a portrait of your jurisdiction on Kate Raworth&apos;s Doughnut of
            social and planetary boundaries: the social foundation residents should never fall below, the
            ecological ceiling the city should not overshoot, every number sourced with the evidence beside it,
            and progress measured against the goals your council already adopted.
          </p>
          {selfServe || showcase || demo ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {selfServe ? (
                <Link
                  href="/start"
                  className="rounded bg-[color:var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Build your city&apos;s doughnut
                </Link>
              ) : null}
              {showcase ? (
                <Link
                  href={showcase.href}
                  className="rounded border border-black/20 px-5 py-2.5 text-sm font-medium hover:bg-black/5"
                >
                  See {showcase.organization.name}
                </Link>
              ) : demo ? (
                <Link
                  href={`/${demo.slug}`}
                  className="rounded border border-black/20 px-5 py-2.5 text-sm font-medium hover:bg-black/5"
                >
                  View the demo portrait
                </Link>
              ) : null}
            </div>
          ) : null}
          {selfServe ? (
            <p className="mt-4 max-w-2xl text-sm text-[color:var(--color-muted)]">
              Published portraits are free for anyone to read. Building one, the research behind every number,
              needs a plan or a contract —{' '}
              <Link href="/pricing" className="underline">
                see pricing
              </Link>
              .
            </p>
          ) : null}
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
            {showcase.members.length > 1 ? (
              <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted)]">
                {showcase.members.length} portraits measured against identical thresholds, so differences
                between places are visible instead of averaged away.
              </p>
            ) : null}
            <ul className="mt-4 flex flex-wrap gap-2 text-sm">
              {showcase.members.map((m) => (
                <li key={m.slug}>
                  <Link className="inline-block rounded-full border border-black/15 px-3 py-1 hover:bg-black/5" href={`/${m.slug}`}>
                    {m.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  className="inline-block rounded-full bg-black px-3 py-1 text-white"
                  href={`/o/${showcase.organization.slug}/progress`}
                >
                  Progress since the baseline →
                </Link>
              </li>
            </ul>
          </section>
        ) : null}

        {/* Every other public portrait, so a visitor can find their city. With a
            showcase this is "the rest" and is left out when there is none; without
            one it is the whole directory, and an empty one says so plainly. */}
        {showcase && listed.length === 0 ? null : (
          <section aria-labelledby="portraits-heading" className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
            <h2 id="portraits-heading" className="text-xl font-semibold">
              {showcase ? 'More portraits on this site' : 'Portraits on this site'}
            </h2>
            {listed.length > 0 ? (
              <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 md:grid-cols-3">
                {listed.map((p) => (
                  <li key={p.slug}>
                    <Link className="inline-block py-1 underline" href={`/${p.slug}`}>
                      {p.name}
                    </Link>
                    {p.region ? <span className="text-[color:var(--color-muted)]"> · {p.region}</span> : null}
                  </li>
                ))}
              </ul>
            ) : demo ? (
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                This server has no database, so it shows only the bundled{' '}
                <Link className="underline" href={`/${demo.slug}`}>
                  demo portrait
                </Link>
                .
              </p>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">No portraits have been published on this site yet.</p>
            )}
          </section>
        )}
      </main>
    </>
  );
}
