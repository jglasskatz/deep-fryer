import type { ReactNode } from 'react';
import Link from 'next/link';
import { framework } from '@deep-fryer/contract';
import {
  ALERTS_STALE_AFTER_MS,
  telHref,
  unwrapAlertText,
  type AlertSeverity,
  type EmergencyConfig,
  type RiskBand,
} from '@deep-fryer/core';
import { AlertsLive, UntilEnded } from './AlertsLive';
import { HazardDoughnut } from './HazardDoughnut';
import type { AlertView, HazardView, PlanView, ResourceView, SyncState } from '@/lib/emergency';
import { dimensionLabel } from '@/lib/i18n/content';
import { fmt, rich } from '@/lib/i18n/format';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages/en';
import type { PublishedDimension } from '@/lib/portrait';
import { safeHref } from '@/lib/safe-url';

/**
 * The public emergency page's sections (SPEC-v5 §3), as plain server
 * components: the page loads the data once and passes each section what it
 * shows. Conventions throughout:
 *
 * - Every word of chrome comes from `m.emergency` (the reader's language);
 *   staff-entered text and NWS alert text are shown as entered and marked
 *   `lang="en"`, so screen readers pronounce them correctly and right-to-left
 *   pages isolate them (globals.css).
 * - Severity, risk, and impact are always written out; colour only repeats
 *   what the text says (WCAG 1.4.1).
 * - Layout uses logical properties (ms/me/ps/pe/start/end, border-s) so
 *   Arabic and Urdu mirror correctly.
 * - Every external link passes through safeHref; phone numbers are tel:
 *   links, laid out left-to-right so their digits never reorder.
 * - Lists and dates follow the reader's language through Intl, with a
 *   neutral fallback where the runtime has no data for it (Haitian Creole):
 *   never English words inside a translated sentence.
 * - In-page link targets clear the sticky header (ANCHOR).
 * - Alerts are re-judged on the reader's device (AlertsLive), because this
 *   HTML is also what a saved or fallback copy shows hours later.
 */

type Href = (path: string) => string;

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  Extreme: 'bg-red-800 text-white',
  Severe: 'bg-red-100 text-red-900',
  Moderate: 'bg-amber-100 text-amber-900',
  Minor: 'bg-sky-100 text-sky-900',
  Unknown: 'bg-black/10',
};

const SEVERITY_EDGE: Record<AlertSeverity, string> = {
  Extreme: 'border-s-red-800',
  Severe: 'border-s-red-600',
  Moderate: 'border-s-amber-500',
  Minor: 'border-s-sky-500',
  Unknown: 'border-s-gray-400',
};

const RISK_STYLE: Record<RiskBand, string> = {
  very_high: 'bg-red-800 text-white',
  high: 'bg-red-100 text-red-900',
  moderate: 'bg-amber-100 text-amber-900',
  low: 'bg-green-100 text-green-900',
};

const badge = 'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium';

/**
 * Scroll margin for every in-page link target (`#alerts`, `#hazard-…`,
 * `#plan-…`, `#doughnut`): the sticky header is 56 px, plus the 40 px
 * family bar on family portraits, plus the language notice on translated
 * pages (up to four lines of small text on a phone). Generous on purpose —
 * a heading landing a little low is harmless; one under the header leaves
 * the reader unsure where they are.
 */
const ANCHOR = 'scroll-mt-48 sm:scroll-mt-36';

/** Text the NWS or staff wrote: long URLs must wrap rather than widen the page. */
const PROSE = 'break-words [overflow-wrap:anywhere]';

/** Whether the runtime has formatting data for the reader's language. */
function intlSupports(kind: 'date' | 'list', locale: Locale): boolean {
  const supported =
    kind === 'date' ? Intl.DateTimeFormat.supportedLocalesOf([locale]) : Intl.ListFormat.supportedLocalesOf([locale]);
  return supported.length > 0;
}

/**
 * "Jul 15, 2026, 8:00 PM EDT": on the city's clock, in the reader's
 * language, naming the zone — a relative reading from another city must not
 * mistake it for their own time. Where Intl has no data for the language
 * (Haitian Creole), an all-numeric "2026-07-15 20:00 EDT" rather than
 * English month names and AM/PM.
 */
export function formatAlertTime(date: Date, locale: Locale, timeZone: string): string {
  if (intlSupports('date', locale)) {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    }).format(date);
  }
  const part = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
      timeZone,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute} ${part.timeZoneName}`;
}

/**
 * A list in the reader's language ("A, B, and C", "A、B和C", "A وB"), as
 * parts: each item's index, and the separators between. Intl formats
 * placeholders, so items can be any markup (links, language-marked names).
 * Where Intl has no data for the language (Haitian Creole), a plain comma
 * list — never an English "and" inside a translated sentence.
 */
export function listParts(locale: Locale, count: number): ({ item: number } | { text: string })[] {
  const items = Array.from({ length: count }, (_, i) => i);
  if (count < 2) return items.map((item) => ({ item }));
  if (!intlSupports('list', locale)) return items.flatMap((item) => (item === 0 ? [{ item }] : [{ text: ', ' }, { item }]));
  const marks = items.map((i) => `{${i}}`);
  return new Intl.ListFormat(locale, { type: 'conjunction' })
    .formatToParts(marks)
    .map((part) => (part.type === 'element' ? { item: marks.indexOf(part.value) } : { text: part.value }));
}

/** Render items as a list in the reader's language (listParts). */
function List({ locale, items }: { locale: Locale; items: { key: string; node: ReactNode }[] }) {
  return (
    <>
      {listParts(locale, items.length).map((part, i) =>
        'item' in part ? <span key={items[part.item]!.key}>{items[part.item]!.node}</span> : <span key={`sep-${i}`}>{part.text}</span>,
      )}
    </>
  );
}

/**
 * A plan's languages, each named in its own language ("Español", "繁體中文"):
 * the app's LOCALES list first, then the runtime's display names for
 * languages the app does not serve, then the bare code. The reader's own
 * language is listed first; English is left out ("also published in").
 */
export function planLanguageNames(codes: string[], reader: Locale): { code: string; name: string }[] {
  const named = codes
    .filter((code) => code.toLowerCase() !== 'en' && !code.toLowerCase().startsWith('en-'))
    .map((code) => {
      const known = LOCALES.find((l) => l.code.toLowerCase() === code.toLowerCase());
      if (known) return { code: known.code as string, name: known.name as string };
      try {
        const own = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        return { code, name: own && own !== code ? own : code };
      } catch {
        return { code, name: code };
      }
    });
  return named.sort((a, b) => Number(b.code === reader) - Number(a.code === reader));
}

const FRAMEWORK_NAMES = new Map(framework.dimensions.map((d) => [d.slug, d.name]));

/** A dimension's name in the reader's language (or the portrait's own name if it renamed it). */
function dimensionName(m: Messages, slug: string, published: Map<string, string>): string {
  return dimensionLabel(m, slug, published.get(slug) ?? FRAMEWORK_NAMES.get(slug) ?? slug);
}

// ---- 1. Active alerts ----------------------------------------------------------------

export function AlertsSection({
  m,
  locale,
  config,
  configured,
  alerts,
  sync,
  hazards,
}: {
  m: Messages;
  locale: Locale;
  config: EmergencyConfig;
  configured: boolean;
  alerts: AlertView[];
  sync: SyncState;
  hazards: HazardView[];
}) {
  const e = m.emergency;
  const when = (d: Date) => formatAlertTime(d, locale, config.time_zone);
  const hazardName = new Map(hazards.map((h) => [h.slug, h.name]));
  const checked = sync.lastSuccessAt ? when(sync.lastSuccessAt) : null;
  const weatherGov = (
    <a className="underline" href="https://www.weather.gov/" lang="en" dir="ltr">
      weather.gov
    </a>
  );
  const notice = 'mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
  return (
    <section className="mt-8" aria-labelledby="alerts">
      <h2 id="alerts" className={`text-xl font-semibold ${ANCHOR}`}>
        {e.alertsTitle}
      </h2>
      {!configured ? (
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">{e.alertsNotConfigured}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {checked ? fmt(e.alertsChecked, { time: checked }) : null} {e.alertsOriginal}
          </p>
          <AlertsLive
            lastSuccessAt={sync.lastSuccessAt?.toISOString() ?? null}
            staleAfterMs={ALERTS_STALE_AFTER_MS}
            serverStale={sync.stale}
            feedNotice={
              <p role="status" className={notice}>
                {e.alertsStale} {weatherGov}
              </p>
            }
            copyNotice={
              <p role="status" className={notice}>
                {checked ? fmt(e.alertsSavedCopy, { time: checked }) : e.alertsStale} {weatherGov}
              </p>
            }
            // Time-bound even in the HTML itself: a copy read later still
            // says when "no alerts" was true.
            none={checked ? <p className="mt-3 text-sm">{fmt(e.alertsNone, { time: checked })}</p> : null}
            endedLabel={e.alertEnded}
            alerts={alerts.map((a) => ({
              id: a.id,
              until: a.until?.toISOString() ?? null,
              card: <AlertCard e={e} alert={a} when={when} hazardName={hazardName} />,
            }))}
          />
        </>
      )}
    </section>
  );
}

function AlertCard({
  e,
  alert: a,
  when,
  hazardName,
}: {
  e: Messages['emergency'];
  alert: AlertView;
  when: (d: Date) => string;
  hazardName: Map<string, string>;
}) {
  const link = safeHref(a.url);
  return (
    <article aria-labelledby={`alert-${a.id}`} className={`rounded border border-black/10 border-s-4 p-4 ${SEVERITY_EDGE[a.severity]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badge} ${SEVERITY_STYLE[a.severity]}`}>{e.severity[a.severity]}</span>
        <h3 id={`alert-${a.id}`} lang="en" className={`min-w-0 text-base font-semibold ${PROSE}`}>
          {a.event}
        </h3>
      </div>
      {a.headline ? (
        <p lang="en" className={`mt-1 text-sm ${PROSE}`}>
          {a.headline}
        </p>
      ) : null}
      <p className={`mt-1 text-sm text-[color:var(--color-muted)] ${PROSE}`}>
        {rich(e.alertArea, { areas: <span lang="en">{a.areaDesc}</span> })}
      </p>
      <p className="mt-1 text-sm">
        {a.until
          ? fmt(e.alertWindow, { start: when(a.effective), end: when(a.until) })
          : fmt(e.alertFrom, { start: when(a.effective) })}
      </p>
      {a.instruction ? (
        <details open className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium">{e.alertInstructions}</summary>
          <p lang="en" className={`mt-1 whitespace-pre-line ${PROSE}`}>
            {unwrapAlertText(a.instruction)}
          </p>
        </details>
      ) : null}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">{e.alertDetails}</summary>
        <p lang="en" className={`mt-1 whitespace-pre-line ${PROSE}`}>
          {unwrapAlertText(a.description)}
        </p>
      </details>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--color-muted)]">
        <span>{rich(e.alertSource, { source: <span lang="en">{a.senderName}</span> })}</span>
        {link ? (
          <a className="underline" href={link} rel="noopener noreferrer">
            {e.alertLink}
          </a>
        ) : null}
        {a.hazardSlugs.map((slug) => (
          <span key={slug}>
            {rich(e.alertRelated, {
              hazard: (
                <a className="underline" href={`#hazard-${slug}`} lang="en">
                  {hazardName.get(slug) ?? slug}
                </a>
              ),
            })}
          </span>
        ))}
      </p>
    </article>
  );
}

// ---- 2. Get official alerts --------------------------------------------------------------

export function hasOfficialContacts(config: EmergencyConfig): boolean {
  return Boolean(safeHref(config.alerts_signup_url) || telHref(config.emergency_phone) || telHref(config.info_phone));
}

function Phone({ phone }: { phone: string }) {
  const tel = telHref(phone);
  return tel ? (
    <a className="font-semibold underline" href={tel} dir="ltr">
      {phone}
    </a>
  ) : (
    <span dir="ltr">{phone}</span>
  );
}

export function GetAlertsSection({ m, config }: { m: Messages; config: EmergencyConfig }) {
  const e = m.emergency;
  const signup = safeHref(config.alerts_signup_url);
  return (
    <section className="mt-10" aria-labelledby="get-alerts">
      <h2 id="get-alerts" className="text-xl font-semibold">
        {e.getAlerts}
      </h2>
      <div className="mt-3 space-y-2 text-sm">
        {signup ? (
          <p>
            <a
              className="inline-block rounded bg-[color:var(--color-accent)] px-3 py-1.5 font-medium text-white hover:opacity-90"
              href={signup}
              rel="noopener noreferrer"
            >
              {/* The action stays in the reader's language; the program's
                  proper name (staff-entered, English) is set inside it. */}
              {config.alerts_signup_label
                ? rich(e.signupNamed, { name: <span lang="en">{config.alerts_signup_label}</span> })
                : e.signupLink}
            </a>
          </p>
        ) : null}
        {config.emergency_phone ? <p className="text-base">{rich(e.emergencyCall, { phone: <Phone phone={config.emergency_phone} /> })}</p> : null}
        {config.info_phone ? <p>{rich(e.infoCall, { phone: <Phone phone={config.info_phone} /> })}</p> : null}
      </div>
    </section>
  );
}

// ---- 3. Threats by risk ----------------------------------------------------------------------

export function ThreatsSection({
  m,
  locale,
  href,
  tenantSlug,
  hazards,
  plans,
  dimensions,
  selected,
}: {
  m: Messages;
  locale: Locale;
  href: Href;
  tenantSlug: string;
  hazards: HazardView[];
  plans: PlanView[];
  dimensions: PublishedDimension[];
  selected: string | null;
}) {
  const e = m.emergency;
  const published = new Map(dimensions.map((d) => [d.slug, d.data.name]));
  const canShowDoughnut = dimensions.length > 0;
  return (
    <section className="mt-10" aria-labelledby="threats">
      <h2 id="threats" className="text-xl font-semibold">
        {e.threatsTitle}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">{e.threatsIntro}</p>
      <ol className="mt-4 space-y-3">
        {hazards.map((h) => {
          const related = plans.filter((p) => p.hazardSlugs.includes(h.slug));
          return (
            <li key={h.id}>
              <article
                id={`hazard-${h.slug}`}
                aria-labelledby={`hazard-title-${h.slug}`}
                className={`rounded border border-black/10 p-4 ${ANCHOR}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`hazard-title-${h.slug}`} lang="en" className="text-base font-semibold">
                    {h.name}
                  </h3>
                  <span className={`${badge} ${RISK_STYLE[h.band]}`}>{e.risk[h.band]}</span>
                  {h.activeNow ? (
                    <UntilEnded until={h.activeUntil?.toISOString() ?? null}>
                      <a href="#alerts" className={`${badge} bg-red-800 text-white underline`}>
                        {e.activeNow}
                      </a>
                    </UntilEnded>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                  {e.hazardKind[h.kind]} · {fmt(e.likelihood, { n: h.likelihood })} · {fmt(e.severityRating, { n: h.severity })}
                </p>
                {h.description ? (
                  <p lang="en" className={`mt-2 text-sm ${PROSE}`}>
                    {h.description}
                  </p>
                ) : null}
                {h.dimensions.length > 0 ? (
                  <p className="mt-2 text-sm">
                    <span className="font-medium">{e.threatens}</span>{' '}
                    <List
                      locale={locale}
                      items={h.dimensions.map((d) => ({
                        key: d.dimension_slug,
                        node: fmt(e.dimensionImpact, {
                          dimension: dimensionName(m, d.dimension_slug, published),
                          impact: e.impactLevel[d.impact],
                        }),
                      }))}
                    />
                  </p>
                ) : null}
                {related.length > 0 ? (
                  <p className="mt-2 text-sm">
                    <span className="font-medium">{e.relatedPlans}</span>{' '}
                    <List
                      locale={locale}
                      items={related.map((p) => ({
                        key: p.id,
                        node: (
                          <a className="underline" href={`#plan-${p.id}`} lang="en">
                            {p.title}
                          </a>
                        ),
                      }))}
                    />
                  </p>
                ) : null}
                {canShowDoughnut && h.dimensions.length > 0 ? (
                  <p className="mt-2 text-sm">
                    <Link
                      className="underline"
                      href={href(`/${tenantSlug}/emergency?hazard=${encodeURIComponent(h.slug)}#doughnut`)}
                      aria-current={selected === h.slug ? 'true' : undefined}
                    >
                      {e.showOnDoughnut}
                    </Link>
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The selected hazard on the doughnut: today's published portrait against
 * the same portrait with the hazard's threatened dimensions tinted by
 * impact (HazardDoughnut). Dimension names are translated here, on the
 * server, so the client receives only the reader's words.
 */
export function HazardDoughnutSection({
  m,
  hazard,
  dimensions,
}: {
  m: Messages;
  hazard: HazardView;
  dimensions: PublishedDimension[];
}) {
  const e = m.emergency;
  const impacts = new Map(hazard.dimensions.map((d) => [d.dimension_slug, d.impact]));
  const published = new Map(dimensions.map((d) => [d.slug, d.data.name]));
  return (
    // tabIndex -1: "Show on the doughnut" lands here, and Next moves focus
    // to a hash target after navigating — focus (and a screen reader's
    // announcement of the new heading) follows the scroll instead of being
    // left in the hazard list far above. The browser's own focus ring shows
    // only for keyboard users.
    <section id="doughnut" tabIndex={-1} className={`mt-10 outline-offset-4 ${ANCHOR}`} aria-labelledby="doughnut-title">
      <h2 id="doughnut-title" className="text-xl font-semibold">
        {rich(e.doughnutThreat, { hazard: <span lang="en">{hazard.name}</span> })}
      </h2>
      <HazardDoughnut
        dimensions={dimensions.map((d) => ({
          slug: d.slug,
          ring: d.ring,
          name: dimensionLabel(m, d.slug, d.data.name),
          current: d.viz_level,
          impact: impacts.get(d.slug) ?? null,
        }))}
        threatened={hazard.dimensions.map((d) => ({
          slug: d.dimension_slug,
          label: fmt(e.dimensionImpact, { dimension: dimensionName(m, d.dimension_slug, published), impact: e.impactLevel[d.impact] }),
          impact: d.impact,
        }))}
        ariaLabel={fmt(e.doughnutLabel, { hazard: hazard.name })}
        labels={{
          now: e.doughnutNow,
          alternate: fmt(e.doughnutThreat, { hazard: hazard.name }),
          play: e.play,
          pause: e.pause,
          controls: e.doughnutControls,
        }}
        threatensLabel={e.threatens}
        legendLabel={e.doughnutLegend}
        impactLabels={e.impactLevel}
      />
    </section>
  );
}

// ---- 4. Plans already in place -------------------------------------------------------------------

export function PlansSection({ m, locale, plans }: { m: Messages; locale: Locale; plans: PlanView[] }) {
  const e = m.emergency;
  return (
    <section className="mt-10" aria-labelledby="plans">
      <h2 id="plans" className="text-xl font-semibold">
        {e.plansTitle}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">{e.plansIntro}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const link = safeHref(p.url);
          const languages = planLanguageNames(p.languages, locale);
          const agency = <span lang="en">{p.agency}</span>;
          return (
            <li key={p.id} id={`plan-${p.id}`} className={`rounded border border-black/10 p-4 ${ANCHOR}`}>
              <h3 lang="en" className={`font-semibold ${PROSE}`}>
                {p.title}
              </h3>
              <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                {p.adoptedYear ? rich(e.planBy, { agency, year: String(p.adoptedYear) }) : rich(e.planAgency, { agency })}
              </p>
              {p.summary ? (
                <p lang="en" className={`mt-2 text-sm ${PROSE}`}>
                  {p.summary}
                </p>
              ) : null}
              {languages.length > 0 ? (
                <p className="mt-2 text-xs">
                  {rich(e.planLanguages, {
                    // <bdi>: each name is isolated, so two right-to-left
                    // names side by side (العربية، اردو) keep their order
                    // and their separator on a left-to-right page.
                    languages: (
                      <List
                        locale={locale}
                        items={languages.map((l) => ({ key: l.code, node: <bdi lang={l.code}>{l.name}</bdi> }))}
                      />
                    ),
                  })}
                </p>
              ) : null}
              {link ? (
                <p className="mt-2 text-sm">
                  <a className="underline" href={link} rel="noopener noreferrer">
                    {e.readPlan}
                  </a>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- 5. Help and mutual aid -----------------------------------------------------------------------

export function HelpSection({
  m,
  locale,
  resources,
  hazards,
}: {
  m: Messages;
  locale: Locale;
  resources: ResourceView[];
  hazards: HazardView[];
}) {
  const e = m.emergency;
  const hazardName = new Map(hazards.map((h) => [h.slug, h.name]));
  return (
    <section className="mt-10" aria-labelledby="help">
      <h2 id="help" className="text-xl font-semibold">
        {e.helpTitle}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">{e.helpIntro}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {resources.map((r) => {
          const tel = telHref(r.phone);
          const site = safeHref(r.url);
          // Only hazards the public can see; a link to a draft would dangle.
          const serves = r.hazardSlugs.filter((s) => hazardName.has(s));
          return (
            <li key={r.id} className="rounded border border-black/10 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--color-muted)]">{e.resourceKind[r.kind]}</p>
              <h3 lang="en" className={`mt-0.5 font-semibold ${PROSE}`}>
                {r.name}
              </h3>
              {r.description ? (
                <p lang="en" className={`mt-1 text-sm ${PROSE}`}>
                  {r.description}
                </p>
              ) : null}
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {tel && r.phone ? (
                  <a className="font-medium underline" href={tel}>
                    {rich(e.call, { phone: <span dir="ltr">{r.phone}</span> })}
                  </a>
                ) : null}
                {site ? (
                  <a className="underline" href={site} rel="noopener noreferrer">
                    {e.website}
                  </a>
                ) : null}
              </p>
              {serves.length > 0 ? (
                <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                  {e.resourceHazards}{' '}
                  <List
                    locale={locale}
                    items={serves.map((s) => ({
                      key: s,
                      node: (
                        <a className="underline" href={`#hazard-${s}`} lang="en">
                          {hazardName.get(s)}
                        </a>
                      ),
                    }))}
                  />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
