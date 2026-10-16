import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { MembersPanel } from '@/components/admin/MembersPanel';
import { PortraitForm } from '@/components/onboarding/PortraitForm';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { LanguageHelpForm } from '@/components/admin/LanguageHelpForm';
import { getAuth, getOrgRole } from '@/lib/auth';
import { billingSummary, WARNING_COPY } from '@/lib/billing';
import { getPortrait } from '@/lib/data';
import { familyByOrgSlug } from '@/lib/family';
import { organizationFeatures } from '@/lib/features';
import { organizationMembersList, pendingInvitations } from '@/lib/member-data';
import { fmt, fmtPlural } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const family = await familyByOrgSlug((await params).org);
  return { title: family?.organization.name ?? 'deep-fryer' };
}

/**
 * Organization hub (SPEC-v4 §2). Public: the organization's portraits and
 * family views. Members additionally see plan standing and usage; owners
 * manage organization roles and add portraits.
 */
export default async function OrgPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params;
  const [family, { m, locale, href }] = await Promise.all([familyByOrgSlug(orgSlug), getI18n()]);
  if (!family) notFound();
  const orgId = family.organization.id;

  const [auth, orgRole, portraits] = await Promise.all([
    getAuth(),
    getOrgRole(orgId),
    Promise.all(family.members.map(async (m) => ({ m, p: await getPortrait(m.slug) }))),
  ]);
  const isOrgMember = orgRole !== null;
  // Compare and Insights are a feature (SPEC-v7 §3): linked only when one of the family's portraits has it on.
  const familyCompare = (await organizationFeatures(orgId)).family_compare;
  const [summary, members, invites] = isOrgMember
    ? await Promise.all([
        billingSummary(orgId),
        organizationMembersList(orgId),
        orgRole === 'owner' ? pendingInvitations({ organizationId: orgId }) : Promise.resolve([]),
      ])
    : [null, [], []];

  return (
    <>
      <SiteHeader
        variant="org"
        family={family.members.length > 1 ? family : null}
        org={family.organization}
      />
      <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">{family.organization.name}</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          {fmtPlural(locale, m.org.portraitCount, family.members.length)}
          {family.members.length > 1 ? (
            <>
              {familyCompare ? (
                <>
                  {' · '}
                  <Link className="underline" href={href(`/o/${orgSlug}/compare`)}>
                    {m.nav.compare}
                  </Link>
                  {' · '}
                  <Link className="underline" href={href(`/o/${orgSlug}/insights`)}>
                    {m.nav.insights}
                  </Link>
                </>
              ) : null}
              {' · '}
              <Link className="underline" href={href(`/o/${orgSlug}/progress`)}>
                {m.nav.progress}
              </Link>
            </>
          ) : null}
        </p>

        {summary ? (
          <section className="mt-8 rounded-lg border border-black/10 p-4" aria-labelledby="plan">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="plan" className="text-lg font-semibold">
                {summary.plan ? `${summary.plan.name} plan` : 'No plan'}
                {summary.subscription ? (
                  <span className="ms-2 text-sm font-normal text-[color:var(--color-muted)]">
                    {summary.subscription.status} · {summary.subscription.collection} · renews{' '}
                    {summary.subscription.currentPeriodEnd.toISOString().slice(0, 10)}
                  </span>
                ) : null}
              </h2>
              <Link className="text-sm underline" href={`/o/${orgSlug}/billing`}>
                Billing
              </Link>
            </div>
            {summary.blockedMessage ? (
              <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-900">
                {summary.blockedMessage}
              </p>
            ) : summary.standing.warning ? (
              <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
                {WARNING_COPY[summary.standing.warning]}
              </p>
            ) : null}
            {summary.limits ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <UsageMeter label="Research sessions this period" used={summary.usage.researchSessions} limit={summary.limits.researchSessions} />
                <UsageMeter label="Portraits" used={summary.usage.portraits} limit={summary.limits.portraits} />
                <UsageMeter label="Seats" used={summary.usage.seats} limit={summary.limits.seats} />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-8" aria-labelledby="portraits">
          <h2 id="portraits" className="text-lg font-semibold">
            {m.org.portraits}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {portraits.map(({ m: member, p }) => {
              const dims = p?.dimensions ?? [];
              const outside = dims.filter((d) => (d.viz_level ?? 0) > 0).length;
              const gaps = dims.filter((d) => d.viz_level === null).length;
              const updated = dims
                .map((d) => d.published_at)
                .filter((x): x is string => Boolean(x))
                .sort()
                .at(-1);
              return (
                <li key={member.slug} className="rounded-lg border border-black/10 p-4">
                  <Link href={href(`/${member.slug}`)} className="font-semibold hover:underline">
                    {member.name}
                  </Link>
                  <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                    {dims.length === 0
                      ? m.org.nothingPublished
                      : `${fmtPlural(locale, m.org.outsideSafeSpace, outside, { total: dims.length })}${
                          gaps ? ` · ${fmtPlural(locale, m.org.dataGaps, gaps)}` : ''
                        }`}
                  </p>
                  {updated ? (
                    <p className="text-xs text-[color:var(--color-muted)]">
                      {fmt(m.common.updated, { date: updated.slice(0, 10) })}
                    </p>
                  ) : null}
                  <p className="mt-2 flex gap-3 text-xs">
                    <Link className="underline" href={href(`/${member.slug}/progress`)}>
                      {m.nav.progress}
                    </Link>
                    {isOrgMember || auth.devMode ? (
                      <Link className="underline" href={`/${member.slug}/admin`}>
                        {m.common.admin}
                      </Link>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {orgRole === 'owner' ? (
          <>
            <section className="mt-10" aria-labelledby="add">
              <details className="rounded-lg border border-black/10 p-4">
                <summary id="add" className="cursor-pointer text-lg font-semibold">
                  Add a portrait
                </summary>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  A {family.noun === 'portrait' ? 'district, ward, or neighborhood' : family.noun}{' '}
                  portrait joins this family&apos;s compare and insights views.
                </p>
                <div className="mt-4">
                  <PortraitForm mode="add" orgSlug={orgSlug} />
                </div>
              </details>
            </section>
            <section className="mt-10">
              <LanguageHelpForm orgSlug={orgSlug} initial={family.organization.languageHelp} />
            </section>
            <section className="mt-10" aria-labelledby="org-people">
              <h2 id="org-people" className="text-lg font-semibold">
                Organization roles
              </h2>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                Owners administer every portrait and the plan; billing contacts manage payment and
                invoices only. Portrait-level roles live on each portrait&apos;s Members page.
              </p>
              <div className="mt-4">
                <MembersPanel
                  scope="organization"
                  slug={orgSlug}
                  members={members.map((m) => ({ ...m, since: m.since.toISOString() }))}
                  invitations={invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
                  canManage
                  roles={['owner', 'billing']}
                  currentUserId={auth.userId}
                />
              </div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
