import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import {
  AlertsSection,
  GetAlertsSection,
  HazardDoughnutSection,
  HelpSection,
  PlansSection,
  ThreatsSection,
  hasOfficialContacts,
} from '@/components/emergency/EmergencySections';
import { SaveForOffline } from '@/components/emergency/SaveForOffline';
import { emergencyView } from '@/lib/emergency';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

// Official alerts change minute to minute: always render from the database.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const [view, { m }] = await Promise.all([emergencyView((await params).tenant), getI18n()]);
  return {
    title: view ? fmt(m.emergency.metaTitle, { name: view.tenant.name }) : m.emergency.navLabel,
    description: view ? fmt(m.emergency.metaDescription, { name: view.tenant.name }) : undefined,
  };
}

/**
 * The emergency / disaster view (SPEC-v5 §3), public and translated. In the
 * order residents need it: what is happening now (official NWS alerts, as
 * issued), how to get official alerts, the threats ranked by risk with the
 * doughnut dimensions each puts at risk, the plans already adopted, and
 * where to get help — then a way to keep the page for when the network
 * fails. No AI output appears here: alerts come from the issuing authority,
 * everything else is staff-curated and published deliberately.
 */
export default async function EmergencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ hazard?: string | string[] }>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const [view, { m, locale, href }] = await Promise.all([emergencyView(tenant), getI18n()]);
  if (!view) notFound();
  const e = m.emergency;

  const asked = typeof query.hazard === 'string' ? query.hazard : null;
  // The doughnut shows the hazard the reader picked, else the highest risk
  // one that threatens any dimension (hazards are sorted by risk).
  const charted = view.hazards.filter((h) => h.dimensions.length > 0);
  const selected = charted.find((h) => h.slug === asked) ?? charted[0] ?? null;
  const showDoughnut = selected !== null && view.dimensions.length > 0;

  const curated = view.hazards.length + view.plans.length + view.resources.length > 0;
  const contacts = hasOfficialContacts(view.config);
  const nothing = !curated && !contacts && !view.alertsConfigured;

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: view.tenant.slug, name: view.tenant.name }} />
      <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm print:hidden">
          <Link className="underline" href={href(`/${view.tenant.slug}`)}>
            {fmt(m.common.back, { name: view.tenant.name })}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{fmt(e.title, { name: view.tenant.name })}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">{e.intro}</p>
        {locale !== 'en' && !nothing ? (
          <p className="mt-2 max-w-3xl text-xs text-[color:var(--color-muted)]">{e.contentInEnglish}</p>
        ) : null}

        {nothing ? (
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">{e.empty}</p>
        ) : (
          <>
            <AlertsSection
              m={m}
              locale={locale}
              config={view.config}
              configured={view.alertsConfigured}
              alerts={view.alerts}
              sync={view.sync}
              hazards={view.hazards}
            />
            {contacts ? <GetAlertsSection m={m} config={view.config} /> : null}
            {view.hazards.length > 0 ? (
              <ThreatsSection
                m={m}
                locale={locale}
                href={href}
                tenantSlug={view.tenant.slug}
                hazards={view.hazards}
                plans={view.plans}
                dimensions={view.dimensions}
                selected={showDoughnut ? selected.slug : null}
              />
            ) : null}
            {showDoughnut ? <HazardDoughnutSection m={m} hazard={selected} dimensions={view.dimensions} /> : null}
            {view.plans.length > 0 ? <PlansSection m={m} locale={locale} plans={view.plans} /> : null}
            {view.resources.length > 0 ? (
              <HelpSection m={m} locale={locale} resources={view.resources} hazards={view.hazards} />
            ) : null}
            {!curated ? <p className="mt-10 text-sm text-[color:var(--color-muted)]">{e.empty}</p> : null}
          </>
        )}

        {/* Bottom margin: the app's fixed "update available" notice must not
            cover the save button on a phone. */}
        <section className="mt-12 mb-20" aria-labelledby="offline">
          <SaveForOffline
            urls={[href(`/${view.tenant.slug}/emergency`), href(`/${view.tenant.slug}`)]}
            labels={{
              title: e.offlineTitle,
              body: e.offlineBody,
              save: e.offlineSave,
              saving: e.offlineSaving,
              saved: e.offlineSaved,
              failed: e.offlineFailed,
              unavailable: e.offlineUnavailable,
              signedIn: e.offlineSignedIn,
              outdated: e.offlineUpdate,
            }}
          />
        </section>
      </main>
    </>
  );
}
