import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { evidenceUrl, getPortrait, hasDatabase } from '@/lib/data';
import { portraitFeatures } from '@/lib/features';
import { localizeDimensions } from '@/lib/i18n/content';
import { fmt } from '@/lib/i18n/format';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { getI18n } from '@/lib/i18n/server';
import { involvementView } from '@/lib/involvement';
import { panelLabels, portraitPanelViews, selectedPanelView } from '@/lib/portrait-panel';

export const dynamic = 'force-dynamic';

/**
 * The portrait's front page: the core view (SPEC-v7 §2), after the Santa Cruz
 * repository's main screen — the doughnut, a detail panel beside it, and the
 * list of dimensions. Selecting a dimension fills the panel without leaving
 * the page; `?dim=<slug>` selects one in the URL, so a selection can be
 * shared and works without JavaScript (this page reads it and renders that
 * dimension's panel; an unknown value is ignored).
 *
 * The panel's data is shaped here, on the server (lib/portrait-panel.ts):
 * evidence snapshot URLs, safe source links, and — only when the portrait's
 * `involvement` feature is on — its published listings. The client gets
 * plain data for every published dimension, so selecting another is instant.
 */
export default async function TenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ dim?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { dim } = await searchParams;
  // Features beyond core (SPEC-v7 §3) decide what the panel may hold: with
  // `involvement` off no listings are read at all, and with `discussion` off
  // nothing here mentions one.
  const features = await portraitFeatures(tenant);
  const [portrait, { m, href, locale }, involvement] = await Promise.all([
    getPortrait(tenant),
    getI18n(),
    features.involvement ? involvementView(tenant) : Promise.resolve(null),
  ]);
  if (!portrait) notFound();

  const slug = portrait.tenant.slug;
  const views = portraitPanelViews(portrait.dimensions, {
    m,
    locale,
    evidenceUrl: (path) => evidenceUrl(slug, path),
    // On: the published listings (none without a database, e.g. the demo).
    // Off: null, so no view carries any.
    listings: features.involvement ? (involvement?.listings ?? []) : null,
  });

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <header>
          <h1 className="text-3xl font-bold">{portrait.tenant.name}</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            <span lang="en">{portrait.tenant.region}</span>
            {portrait.tenant.population
              ? ` · ${fmt(m.portrait.population, { n: portrait.tenant.population.toLocaleString('en-US') })}`
              : null}
          </p>
          {portrait.tenant.description ? (
            <p lang="en" className="mt-4 max-w-2xl">
              {portrait.tenant.description}
            </p>
          ) : null}
        </header>

        <div className="mt-10">
          <PortraitDoughnut
            tenantSlug={slug}
            tenantName={portrait.tenant.name}
            dimensions={localizeDimensions(m, portrait.dimensions)}
            labels={doughnutLabels(m)}
            linkBase={`${href(`/${slug}`)}/dim`}
            size={720}
            // The visible list of dimensions (SPEC-v6 §2.1): on a phone it,
            // not the canvas, is the way in. Its intro promises a discussion
            // on every dimension, so it is shown only when the portrait has
            // one. How to use the chart is the empty panel's own text; the
            // line under the chart is kept for the demo's notice.
            explore={{
              title: m.portrait.exploreTitle,
              intro: features.discussion ? m.portrait.exploreIntro : m.portrait.exploreIntroCore,
              hint: hasDatabase() ? undefined : m.portrait.demoHint,
            }}
            panel={{
              views,
              initial: selectedPanelView(views, dim)?.slug ?? null,
              labels: panelLabels(m),
              pageHref: href(`/${slug}`),
              discussion: features.discussion,
              englishNote: locale !== 'en',
            }}
          />
        </div>

        <nav className="mt-10 text-center text-sm">
          <a className="underline" href={href(`/${portrait.tenant.slug}/methodology`)}>
            {m.nav.methodology}
          </a>
          <span className="mx-2 text-[color:var(--color-muted)]">·</span>
          <a className="underline" href={href(`/${portrait.tenant.slug}/outreach`)}>
            {m.nav.getInvolved}
          </a>
        </nav>
      </main>
    </>
  );
}
