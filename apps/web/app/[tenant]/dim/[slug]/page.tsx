import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { Thread } from '@/components/discussion/Thread';
import { InvolvementForm } from '@/components/involvement/InvolvementForm';
import { InvolvementLanguageNote, InvolvementListings } from '@/components/involvement/InvolvementListings';
import { evidenceUrl, getPortrait, hasDatabase } from '@/lib/data';
import { dimensionForPublicSlug, dimensionThread } from '@/lib/discussion';
import { getAuth, getRole, roleAtLeast } from '@/lib/auth';
import { issueFormToken } from '@/lib/form-token';
import { formDimensionOptions, involvementView, isFrameworkDimension } from '@/lib/involvement';
import { portraitFeatures } from '@/lib/features';
import { frameworkSlugOf } from '@/lib/policy';
import { safeHref } from '@/lib/safe-url';
import { DEFAULT_EMERGENCY_TIME_ZONE, formatIndicatorValue, listingsForDimension } from '@deep-fryer/core';
import { dimensionLabel, scaleLabel } from '@/lib/i18n/content';
import { fmt, rich } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/**
 * The public drilldown (SPEC.md §10): value, target, plain-language context,
 * evidence snapshot beside each claim, how to get involved, and the
 * dimension's discussion thread. No AI chrome anywhere.
 *
 * "How to get involved" (SPEC-v6 §4.1–4.2): the portrait's published
 * listings for this dimension, then those for every dimension; then the
 * dimension's own short actions; then the form organizations use to put
 * themselves forward, collapsed so it does not push the discussion far down
 * a phone screen.
 */
export default async function DimensionDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { tenant, slug } = await params;
  const { sort: sortRaw } = await searchParams;
  const sort = sortRaw === 'new' ? 'new' : 'top';

  // "Get involved" and the discussion are features the portrait turns on
  // (SPEC-v7 §3); with one off its section is not rendered at all, and the
  // core page (the dimension's data, evidence, gaps) is unchanged.
  const features = await portraitFeatures(tenant);
  const [portrait, resolved, auth, { m, href, locale }, involvement] = await Promise.all([
    getPortrait(tenant),
    hasDatabase() && features.discussion ? dimensionForPublicSlug(tenant, slug) : Promise.resolve(null),
    getAuth(),
    getI18n(),
    features.involvement ? involvementView(tenant) : Promise.resolve(null),
  ]);
  if (!portrait) notFound();
  const dim = portrait.dimensions.find((d) => d.slug === slug);
  if (!dim) notFound();
  const data = dim.data;

  // Listings and submissions are keyed by framework slug; a portrait's own
  // dimension (renamed, or custom with a canonical_slug) maps to one the
  // same way the policy analysis does.
  const frameworkSlug = frameworkSlugOf(dim);
  const listings = involvement ? listingsForDimension(involvement.listings, frameworkSlug) : [];
  // The form needs somewhere to store what it sends: not offered on the
  // bundled demo portrait (no database).
  const formToken = involvement ? issueFormToken(tenant) : null;
  const dimensionName = dimensionLabel(m, dim.slug, data.name);

  let thread = null;
  let isModerator = false;
  const viewerId = auth.userId;
  const canPost = Boolean(auth.userId) || auth.devMode;
  const dimensionId = resolved?.dimension.id ?? null;
  if (resolved) {
    const role = await getRole(resolved.tenant.id);
    isModerator = roleAtLeast(role, 'moderator');
    thread = await dimensionThread(resolved.tenant.id, resolved.dimension.id, viewerId, sort, { isModerator });
  }

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
        <h1 className="mt-2 text-3xl font-bold">{dimensionName}</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          {dim.ring === 'social' ? m.common.socialFoundation : m.common.ecologicalCeiling}
          {dim.published_at ? ` · ${fmt(m.dimension.updated, { date: dim.published_at.slice(0, 10) })}` : ''}
        </p>

        {data.context ? (
          <p lang="en" className="mt-5 max-w-prose">
            {data.context}
          </p>
        ) : null}

        <section className="mt-8 space-y-5">
          {data.indicators.map((ind, i) => (
            <div key={i} className="rounded-lg border border-black/15 p-4">
              <h2 lang="en" className="font-semibold">
                {ind.name}
              </h2>
              <p className="mt-2 text-2xl font-bold">
                {ind.value === null || ind.value === '' ? (
                  <span className="text-base font-normal">{m.common.noData}</span>
                ) : (
                  <bdi>{formatIndicatorValue(ind.value, ind.unit)}</bdi>
                )}
              </p>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                {ind.year ? `${ind.year} · ` : ''}
                {ind.target !== null
                  ? fmt(m.dimension.target, { value: formatIndicatorValue(ind.target, ind.unit) })
                  : m.dimension.noTarget}
                {ind.geographic_scale
                  ? ` · ${fmt(m.dimension.scaleData, { scale: scaleLabel(m, ind.geographic_scale) })}`
                  : ''}
              </p>
              {ind.source ? (
                <p className="mt-2 text-sm">
                  {rich(m.dimension.source, {
                    source: safeHref(ind.source_url) ? (
                      <a lang="en" className="underline" href={safeHref(ind.source_url)} target="_blank" rel="noreferrer">
                        {ind.source}
                      </a>
                    ) : (
                      <span lang="en">{ind.source}</span>
                    ),
                  })}
                </p>
              ) : null}
              {ind.evidence ? (
                <figure className="mt-3">
                  <a
                    href={evidenceUrl(tenant, ind.evidence.snapshot_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={evidenceUrl(tenant, ind.evidence.snapshot_path)}
                      alt={fmt(m.dimension.snapshotAlt, { name: ind.name, date: ind.evidence.captured_at.slice(0, 10) })}
                      className="max-h-56 rounded border border-black/15"
                    />
                  </a>
                  <figcaption className="mt-1 text-xs text-[color:var(--color-muted)]">
                    {fmt(m.dimension.snapshotCaptured, { date: ind.evidence.captured_at.slice(0, 10) })}
                    {ind.evidence.pdf_path ? (
                      <>
                        {' · '}
                        <a
                          className="underline"
                          href={evidenceUrl(tenant, ind.evidence.pdf_path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.dimension.originalDocument}
                        </a>
                      </>
                    ) : null}
                  </figcaption>
                </figure>
              ) : null}
            </div>
          ))}

          {(data.gaps ?? []).map((gap, i) => (
            <div
              key={`gap-${i}`}
              className="rounded-lg border border-dashed border-black/25 bg-black/[0.02] p-4"
            >
              <h2 className="font-semibold">{m.dimension.dataGap}</h2>
              <p lang="en" className="mt-1 text-sm">
                {gap.reason}
              </p>
              {gap.scales_tried.length ? (
                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                  {fmt(m.dimension.searchedAt, { scales: gap.scales_tried.map((sc) => scaleLabel(m, sc)).join(', ') })}
                </p>
              ) : null}
            </div>
          ))}
        </section>

        {features.involvement ? (
          <section className="mt-10" aria-labelledby="get-involved">
            {/* The portrait panel links here ("N more ways to get involved"); the
                scroll margin keeps the heading clear of the sticky header, as
                the panel's own anchor does (components/portrait/PortraitPanel). */}
            <h2 id="get-involved" className="scroll-mt-48 text-lg font-semibold sm:scroll-mt-36">
              {m.involvement.title}
            </h2>
            {listings.length > 0 ? <InvolvementLanguageNote m={m} locale={locale} /> : null}
            <InvolvementListings
              m={m}
              locale={locale}
              timeZone={involvement?.timeZone ?? DEFAULT_EMERGENCY_TIME_ZONE}
              listings={listings}
              markGeneral
              // The dimension's own short actions below are a way in too; the
              // "no listings yet" line is only for a dimension with neither.
              empty={data.actions.length > 0 ? null : m.involvement.none}
            />

            {data.actions.length > 0 ? (
              <>
                <h3 className="mt-6 font-semibold">
                  {listings.length > 0 ? m.dimension.moreYouCanDo : m.dimension.whatYouCanDo}
                </h3>
                <ul lang="en" className="mt-2 list-disc space-y-1 ps-5 text-sm">
                  {data.actions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {formToken ? (
              <details className="mt-6 rounded border border-black/15 px-4 py-1">
                <summary className="cursor-pointer py-2.5 font-medium">{m.involvement.open}</summary>
                <div className="pb-4">
                  <p className="mt-1 text-sm">{fmt(m.involvement.formIntro, { dimension: dimensionName })}</p>
                  <InvolvementForm
                    tenantSlug={tenant}
                    token={formToken}
                    labels={m.involvement}
                    dimensions={formDimensionOptions(m, portrait.dimensions)}
                    defaultDimension={isFrameworkDimension(frameworkSlug) ? frameworkSlug : null}
                  />
                </div>
              </details>
            ) : null}
          </section>
        ) : data.actions.length > 0 ? (
          // With "Get involved" off, the dimension's own actions stay: they
          // are part of the research (the Santa Cruz panel's "ways to get
          // involved"), not of the curated listings feature.
          <section className="mt-10">
            <h2 className="text-lg font-semibold">{m.dimension.whatYouCanDo}</h2>
            <ul lang="en" className="mt-3 list-disc space-y-1 ps-5 text-sm">
              {data.actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {dimensionId && thread !== null ? (
          <Thread
            tenantSlug={tenant}
            dimensionId={dimensionId}
            comments={thread}
            viewerId={viewerId}
            canPost={canPost}
            isModerator={isModerator}
            sort={sort}
            labels={{ ...m.discussion, signIn: m.common.signIn }}
            signInHref={`/login?next=${encodeURIComponent(href(`/${tenant}/dim/${slug}`))}`}
          />
        ) : null}
      </main>
    </>
  );
}
