import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_EMERGENCY_TIME_ZONE } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { InvolvementForm } from '@/components/involvement/InvolvementForm';
import { InvolvementLanguageNote, InvolvementListings } from '@/components/involvement/InvolvementListings';
import { getPortrait, publishedOutreachContacts } from '@/lib/data';
import { issueFormToken } from '@/lib/form-token';
import { dimensionLabel } from '@/lib/i18n/content';
import { fmt } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages/en';
import { getI18n } from '@/lib/i18n/server';
import { pageTitle } from '@/lib/page-meta';
import {
  formDimensionOptions,
  groupListingsByDimension,
  involvementView,
  isPortraitDimension,
} from '@/lib/involvement';
import type { PublishedDimension } from '@/lib/portrait';
import { portraitFeatures } from '@/lib/features';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

/** "Get involved · New York City" (WCAG 2.4.2), in the reader's language. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const [portrait, { m }] = await Promise.all([getPortrait((await params).tenant), getI18n()]);
  if (!portrait) return { title: m.notFound.title };
  return {
    title: pageTitle(m.outreach.title, portrait.tenant.name),
    description: fmt(m.outreach.metaDescription, { name: portrait.tenant.name }),
  };
}

/**
 * Get involved (SPEC-v6 §4.1–4.2; listings and form behind the involvement
 * feature, SPEC-v7 §3): every published way to take part in the
 * portrait, grouped by dimension in the doughnut's order, then the ways
 * that serve every dimension; the form organizations use to put themselves
 * forward; and, second, the organizations working on the portrait's data
 * (research outreach contacts), when any are published.
 *
 * The dimension filter is a row of links (`?dim=<portrait dimension slug>`), so it
 * works without script and with one tap on a phone; the current choice is
 * marked aria-current. An unknown `dim` is ignored (everything is shown).
 */
export default async function OutreachPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ dim?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { dim: dimRaw } = await searchParams;
  // The page itself is core: it predates the listings, and the organizations
  // research found working on the portrait's data are part of the portrait.
  // The curated listings, their filter, and the organization form are the
  // involvement feature's (SPEC-v7 §3) and are not rendered with it off.
  const features = await portraitFeatures(tenant);
  const [portrait, contacts, { m, href, locale }, involvement] = await Promise.all([
    getPortrait(tenant),
    publishedOutreachContacts(tenant),
    getI18n(),
    features.involvement ? involvementView(tenant) : Promise.resolve(null),
  ]);
  if (!portrait) notFound();

  const listings = involvement?.listings ?? [];
  const timeZone = involvement?.timeZone ?? DEFAULT_EMERGENCY_TIME_ZONE;
  const selected = typeof dimRaw === 'string' && isPortraitDimension(dimRaw, portrait.dimensions) ? dimRaw : null;
  const order = portrait.dimensions.map(d => d.slug);
  const everything = groupListingsByDimension(listings, null, order);
  const shown = groupListingsByDimension(listings, selected, order);

  // Headings name each dimension as this portrait publishes it (in the
  // reader's language) and link to its page; a dimension the portrait has
  // not published still gets the framework's name, without a link.
  const published = new Map<string, PublishedDimension>();
  for (const d of portrait.dimensions) {
    const slug = d.slug;
    if (!published.has(slug)) published.set(slug, d);
  }
  const nameOf = (slug: string) => {
    const d = published.get(slug);
    return d ? dimensionLabel(m, d.slug, d.data.name) : (m.dimensions[slug as keyof Messages['dimensions']] ?? slug);
  };
  const pageOf = (slug: string) => {
    const d = published.get(slug);
    return d ? href(`/${tenant}/dim/${d.slug}`) : null;
  };
  const filterHref = (slug: string | null) => href(`/${tenant}/outreach${slug ? `?dim=${encodeURIComponent(slug)}` : ''}`);

  // Nothing to store a submission in on the bundled demo portrait (no database).
  const formToken = involvement ? issueFormToken(tenant) : null;

  const chip =
    'inline-flex min-h-11 items-center rounded-full border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5';
  const chipCurrent = 'inline-flex min-h-11 items-center rounded-full bg-black px-3 py-1.5 text-sm font-medium text-white';

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main id="main" className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={href(`/${tenant}`)}>
            {fmt(m.common.back, { name: portrait.tenant.name })}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{m.outreach.title}</h1>
        {features.involvement ? (
          <p className="mt-2 max-w-prose text-[color:var(--color-muted)]">{m.outreach.intro}</p>
        ) : null}

        {listings.length > 0 ? (
          <>
            <InvolvementLanguageNote m={m} locale={locale} />

            {everything.dimensions.length > 0 ? (
              <nav aria-label={m.involvement.filterLabel} className="mt-6">
                <ul className="flex flex-wrap gap-2">
                  {[null, ...everything.dimensions.map((g) => g.slug)].map((slug) => {
                    const current = selected === slug;
                    return (
                      <li key={slug ?? 'all'}>
                        <Link
                          href={filterHref(slug)}
                          scroll={false}
                          aria-current={current ? 'page' : undefined}
                          className={current ? chipCurrent : chip}
                        >
                          {slug ? nameOf(slug) : m.involvement.filterAll}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : null}

            {shown.dimensions.map((group) => {
              const page = pageOf(group.slug);
              return (
                <section key={group.slug} className="mt-10" aria-labelledby={`dim-${group.slug}`}>
                  <h2 id={`dim-${group.slug}`} className="text-xl font-semibold">
                    {page ? (
                      <Link className="hover:underline" href={page}>
                        {nameOf(group.slug)}
                      </Link>
                    ) : (
                      nameOf(group.slug)
                    )}
                  </h2>
                  <InvolvementListings m={m} locale={locale} timeZone={timeZone} listings={group.listings} />
                </section>
              );
            })}

            {/* A filter for a dimension with nothing of its own still says so,
                before the listings that serve every dimension. */}
            {selected && shown.dimensions.length === 0 ? (
              <section className="mt-10" aria-labelledby={`dim-${selected}`}>
                <h2 id={`dim-${selected}`} className="text-xl font-semibold">
                  {nameOf(selected)}
                </h2>
                <p className="mt-3 text-sm text-[color:var(--color-muted)]">{m.involvement.none}</p>
              </section>
            ) : null}

            {shown.general.length > 0 ? (
              <section className="mt-10" aria-labelledby="every-dimension">
                <h2 id="every-dimension" className="text-xl font-semibold">
                  {m.involvement.forEveryDimension}
                </h2>
                <InvolvementListings m={m} locale={locale} timeZone={timeZone} listings={shown.general} />
              </section>
            ) : null}
          </>
        ) : features.involvement || contacts.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--color-muted)]">
            {contacts.length > 0 ? m.involvement.noneAtAll : m.outreach.empty}
          </p>
        ) : null}

        {formToken ? (
          <section className="mt-12 rounded border border-black/15 p-4 sm:p-6" aria-labelledby="suggest">
            <h2 id="suggest" className="text-xl font-semibold">
              {m.involvement.formTitle}
            </h2>
            <p className="mt-1 text-sm">{m.involvement.formIntroGeneral}</p>
            <InvolvementForm
              tenantSlug={tenant}
              token={formToken}
              labels={m.involvement}
              dimensions={formDimensionOptions(m, portrait.dimensions)}
            />
          </section>
        ) : null}

        {contacts.length > 0 ? (
          <section className="mt-12" aria-labelledby="partners">
            <h2 id="partners" className="text-xl font-semibold">
              {m.outreach.partnersTitle}
            </h2>
            <ul lang="en" className="mt-4 space-y-4">
              {contacts.map((c, i) => (
                <li key={i} className="rounded border border-black/15 p-4">
                  <h3 className="font-semibold">
                    {/* Published outreach comes from research and staff edits: only
                        http(s) links render (safeHref), never javascript: or data:. */}
                    {safeHref(c.website) ? (
                      <a className="underline" href={safeHref(c.website)} target="_blank" rel="noopener noreferrer">
                        {c.org}
                      </a>
                    ) : (
                      c.org
                    )}
                  </h3>
                  {c.why ? <p className="mt-1 text-sm">{c.why}</p> : null}
                  {c.tags.length ? (
                    <p className="mt-2 text-xs text-[color:var(--color-muted)]">{c.tags.join(' · ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
