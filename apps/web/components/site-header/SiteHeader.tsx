import Link from 'next/link';
import { signOut } from '@/auth';
import { FamilyNav } from './FamilyNav';
import { HeaderMenuDismiss } from './HeaderMenuDismiss';
import { adminNavLinks, tenantNavLinks, type NavLink, type PortraitFeatures } from './nav-links';
import { LanguageNotice, LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { SignOutButton } from '@/components/pwa/SignOutButton';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { loginI18n } from '@/app/login/i18n';
import { signInHref } from '@/app/login/sign-in';
import { adminTenant } from '@/lib/admin-data';
import { getAuth } from '@/lib/auth';
import { countHeldComments } from '@/lib/discussion';
import { deploymentFeatureOn, portraitFeatures } from '@/lib/features';
import { authConfigured, hasDatabase } from '@/lib/env';
import { familyForTenant, organizationOfTenant, type Family } from '@/lib/family';
import { countNewSubmissions } from '@/lib/involvement-admin';
import { getI18n, getRequestPath } from '@/lib/i18n/server';

type Variant = 'landing' | 'sign-in' | 'tenant' | 'admin' | 'architecture' | 'org' | 'account';

interface SiteHeaderProps {
  variant: Variant;
  tenant?: { slug: string; name: string };
  /** Org-level pages (compare, insights, progress, billing) pass their family. */
  family?: Family | null;
  familyView?: 'compare' | 'insights' | 'progress';
  /** Org pages that are not family views (billing, members) name the org instead. */
  org?: { slug: string; name: string; languageHelp?: string | null };
}

/**
 * The admin queues' sizes for the navigation badges (SPEC-v6 §3.2, §4.3):
 * held comments and new organization submissions. Read as the signed-in
 * person, under row-level security: submissions (which hold contact
 * details) count 0 for anyone below editor, so their badge does not show.
 * A queue whose feature is off is not counted (its link is not shown).
 */
async function adminQueueCounts(
  tenantSlug: string,
  features: PortraitFeatures,
): Promise<{ heldComments: number; newSubmissions: number } | null> {
  const tenant = await adminTenant(tenantSlug);
  if (!tenant) return null;
  const [heldComments, newSubmissions] = await Promise.all([
    features.discussion ? countHeldComments(tenant.id) : 0,
    features.involvement ? countNewSubmissions(tenant.id) : 0,
  ]);
  return { heldComments, newSubmissions };
}

/**
 * The admin link for the page being shown: the longest link path the
 * request path falls under, so /nyc/admin/review/… marks Review rather than
 * Overview. Overview itself is marked only on the overview page and on pages
 * no other link covers (the dimension editor).
 */
function currentAdminHref(links: NavLink[], requestPath: string): string | undefined {
  const path = requestPath.split('?')[0]!;
  let best: string | undefined;
  for (const l of links) {
    if ((path === l.href || path.startsWith(`${l.href}/`)) && (!best || l.href.length > best.length)) best = l.href;
  }
  return best;
}

/**
 * The one header for every surface. Server-rendered: it reads the session to
 * show the account menu. On small screens the links fold into a disclosure
 * menu (<details>, no JavaScript needed) — the installed PWA is used on
 * phones at community-board meetings as much as on desktops at City Hall.
 * With script, HeaderMenuDismiss also closes the <details> menus on Escape,
 * on focus leaving them, and on a press outside.
 *
 * Public-plane labels come from the request's language catalog; staff and
 * product labels (admin, landing) are English because those pages only
 * exist in English (lib/i18n/routing.ts).
 *
 * The sign-in pages ('sign-in') are the exception to both: they have one
 * unprefixed URL yet speak the reader's remembered language
 * (app/login/i18n.ts), so the header takes its labels — skip link, sign-in,
 * theme menu — from there, and it carries no product links, whose pages
 * (pricing, starting a portrait) exist only in English; the sign-in page
 * itself offers staff the way to start a portrait, in the reader's words.
 */
export async function SiteHeader({ variant, tenant, family, familyView, org }: SiteHeaderProps) {
  const auth = hasDatabase() || !authConfigured() ? await getAuth() : null;
  const [{ m, href, locale }, requestPath] = await Promise.all([
    variant === 'sign-in' ? loginI18n() : getI18n(),
    getRequestPath(),
  ]);
  const tenantFamily = tenant && !family ? await familyForTenant(tenant.slug) : null;
  const shownFamily = family ?? tenantFamily;
  const tenantOrg = tenant ? await organizationOfTenant(tenant.slug) : null;
  const languageHelp = org?.languageHelp ?? shownFamily?.organization.languageHelp ?? tenantOrg?.languageHelp ?? null;
  const publicPlane = variant === 'tenant' || variant === 'org';

  const links: NavLink[] = [];
  if (variant === 'landing' || variant === 'account' || variant === 'architecture') {
    // The product links are English (their pages exist only in English), but this header also tops pages in
    // the reader's language — a 404 under /es/… — so they say which language they are in (WCAG 3.1.2).
    const lang = locale === 'en' ? undefined : 'en';
    links.push({ href: '/pricing', label: 'Pricing', lang });
    if (auth?.userId) links.push({ href: '/account', label: 'My portraits', lang });
    // Starting a portrait is the deployment's self_serve feature: without it /start is a 404, so no link.
    if (deploymentFeatureOn('self_serve')) links.push({ href: '/start', label: 'Start a portrait', primary: true, lang });
  }
  // Feature links follow the portrait's features (SPEC-v7 §3.3); the lists
  // themselves are built, and tested, in nav-links.ts.
  if (variant === 'tenant' && tenant) {
    const features = await portraitFeatures(tenant.slug);
    links.push(
      ...tenantNavLinks(
        tenant.slug,
        features,
        {
          progress: m.nav.progress,
          methodology: m.nav.methodology,
          getInvolved: m.nav.getInvolved,
          emergency: m.emergency.navLabel,
        },
        href,
      ),
    );
  }
  if (variant === 'admin' && tenant) {
    const features = await portraitFeatures(tenant.slug);
    const counts = hasDatabase() ? await adminQueueCounts(tenant.slug, features) : null;
    links.push(...adminNavLinks({ tenantSlug: tenant.slug, orgSlug: tenantOrg?.slug ?? null, features, counts }));
  }

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  const linkClass = (l: NavLink) =>
    l.primary
      ? 'rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-white hover:opacity-90'
      : 'rounded px-3 py-1.5 hover:bg-black/5';

  /**
   * Staff pages carry eleven links — too many for the header row: at
   * 1280 px the row would need ~1300 px of a 1104 px content width, and the
   * portrait's name in the breadcrumb is the first thing squeezed out. So
   * from `md` up the admin links get a row of their own under the header
   * row (wrapping, never scrolling sideways, so no section hides off-edge
   * at tablet widths); below `md` they live in the menu like every
   * variant's links.
   */
  const adminRow = variant === 'admin' && links.length > 0;
  const activeHref = adminRow ? currentAdminHref(links, requestPath) : undefined;

  const linkContent = (l: NavLink) => (
    <>
      {l.label}
      {l.count ? (
        <>
          <span
            aria-hidden
            className="ms-1.5 inline-block min-w-5 rounded-full bg-amber-100 px-1.5 text-center text-xs font-semibold text-amber-900"
          >
            {l.count}
          </span>
          <span className="sr-only">{` (${l.count} ${l.countLabel ?? ''})`}</span>
        </>
      ) : null}
    </>
  );

  const accountControl =
    auth && !auth.devMode && hasDatabase() ? (
      auth.userId ? (
        <details name="df-header-menu" className="relative">
          <summary
            className="flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 hover:bg-black/5"
            aria-label={m.common.accountMenu}
          >
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-xs font-semibold text-white"
            >
              {(auth.displayName ?? auth.name ?? auth.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
          </summary>
          <div className="absolute end-0 z-50 mt-1 w-56 rounded border border-black/10 bg-white p-1 text-sm shadow-lg">
            <p className="truncate px-3 py-2 text-xs text-[color:var(--color-muted)]">{auth.email}</p>
            <Link className="block rounded px-3 py-2 hover:bg-black/5" href="/account">
              {m.common.accountAndPortraits}
            </Link>
            <InstallAppButton
              label={m.common.installApp}
              className="block w-full rounded px-3 py-2 text-start hover:bg-black/5"
            />
            <SignOutButton
              action={doSignOut}
              label={m.common.signOut}
              className="block w-full rounded px-3 py-2 text-start hover:bg-black/5"
            />
          </div>
        </details>
      ) : (
        // Back to this very page after signing in, in the reader's language
        // (SPEC-v6 §2.2): someone who started on Housing returns to Housing.
        <Link
          href={signInHref(requestPath, href)}
          className="whitespace-nowrap rounded border border-black/15 px-3 py-1.5 hover:bg-black/5"
        >
          {m.common.signIn}
        </Link>
      )
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-[color:var(--color-bg)]/90 backdrop-blur print:static">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {m.common.skipToContent}
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight hover:opacity-80">
          <span aria-hidden className="text-lg">
            🍩
          </span>
          {/* On phones a page with a breadcrumb keeps the doughnut and gives
              the wordmark's width to the place name (the header row also
              carries language, theme, account and menu controls). sr-only,
              not hidden, so the link keeps its accessible name. */}
          <span className={tenant || org ? 'sr-only sm:not-sr-only' : undefined}>deep-fryer</span>
        </Link>

        {tenant ? (
          <nav aria-label={m.common.breadcrumb} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden className="text-[color:var(--color-muted)]">
              /
            </span>
            <Link dir="auto" href={href(`/${tenant.slug}`)} className="truncate font-medium hover:underline">
              {tenant.name}
            </Link>
            {variant === 'admin' ? (
              <>
                <span aria-hidden className="text-[color:var(--color-muted)]">
                  /
                </span>
                <span className="font-medium">Admin</span>
              </>
            ) : null}
          </nav>
        ) : org ? (
          <nav aria-label={m.common.breadcrumb} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden className="text-[color:var(--color-muted)]">
              /
            </span>
            <Link dir="auto" href={href(`/o/${org.slug}`)} className="truncate font-medium hover:underline">
              {org.name}
            </Link>
          </nav>
        ) : null}

        {variant === 'architecture' ? (
          <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
            Internal
          </span>
        ) : null}

        {adminRow ? null : (
          <nav aria-label={m.common.mainNav} className="ms-auto hidden items-center gap-1 text-sm md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} lang={l.lang} className={linkClass(l)}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        {/* The controls' dropdowns (language, theme, account, menu) are each
            `absolute end-0` under their own trigger. On phones that runs a
            224–240 px menu off the start edge when its trigger sits mid-row
            (measured: the language menu 35–118 px off at 320–390 px behind a
            translated "Sign in"), and overflow on the start side cannot be
            scrolled to, in LTR or RTL. So below `sm` the triggers' wrappers
            drop their positioning (`static`; the `:is()` outranks their own
            `relative`) and every menu anchors to this group's end edge,
            which is the row's content edge. The details menus keep their
            static top (just under their summary); the theme menu's
            `top-full` is the group's height, which equals the toggle's.
            From `sm` up each menu sits under its own trigger again. */}
        <div
          className={`relative ms-auto flex items-center gap-1 text-sm max-sm:[&>:is(details,div)]:static ${adminRow ? '' : 'md:ms-1'}`}
        >
          {publicPlane ? <LanguageSwitcher /> : null}
          {/* Every variant: light/dark, and press-and-hold for the fryer (SPEC-v5 §4). */}
          <ThemeToggle labels={m.theme} deepFry={deploymentFeatureOn('deep_fry')} />
          {accountControl}
          {links.length > 0 ? (
            <details name="df-header-menu" className="relative md:hidden">
              <summary
                className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded hover:bg-black/5"
                aria-label={m.common.menu}
              >
                <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 5h14M3 10h14M3 15h14" />
                </svg>
              </summary>
              <div className="absolute end-0 z-50 mt-1 w-60 rounded border border-black/10 bg-white p-1 text-sm shadow-lg">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    lang={l.lang}
                    aria-current={l.href === activeHref ? 'page' : undefined}
                    className={`block rounded px-3 py-2.5 hover:bg-black/5 ${l.href === activeHref ? 'bg-black/5 font-medium' : ''}`}
                  >
                    {linkContent(l)}
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {adminRow ? (
        <div className="hidden border-t border-black/5 md:block">
          <nav
            aria-label={m.common.mainNav}
            className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-1.5 text-sm sm:px-6"
          >
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === activeHref ? 'page' : undefined}
                className={`whitespace-nowrap ${linkClass(l)} ${l.href === activeHref ? 'bg-black/5 font-medium' : ''}`}
              >
                {linkContent(l)}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
      {variant !== 'landing' && shownFamily ? (
        <FamilyNav family={shownFamily} currentSlug={tenant?.slug} currentView={familyView} />
      ) : null}
      {publicPlane ? <LanguageNotice languageHelp={languageHelp} /> : null}
      <HeaderMenuDismiss />
    </header>
  );
}
