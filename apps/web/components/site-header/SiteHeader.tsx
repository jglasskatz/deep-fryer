import Link from 'next/link';
import { signOut } from '@/auth';
import { FamilyNav } from './FamilyNav';
import { LanguageNotice, LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { SignOutButton } from '@/components/pwa/SignOutButton';
import { getAuth } from '@/lib/auth';
import { authConfigured, hasDatabase } from '@/lib/env';
import { familyForTenant, organizationOfTenant, type Family } from '@/lib/family';
import { getI18n } from '@/lib/i18n/server';

type Variant = 'landing' | 'tenant' | 'admin' | 'architecture' | 'org' | 'account';

interface SiteHeaderProps {
  variant: Variant;
  tenant?: { slug: string; name: string };
  /** Org-level pages (compare, insights, progress, billing) pass their family. */
  family?: Family | null;
  familyView?: 'compare' | 'insights' | 'progress';
  /** Org pages that are not family views (billing, members) name the org instead. */
  org?: { slug: string; name: string; languageHelp?: string | null };
}

interface NavLink {
  href: string;
  label: string;
  primary?: boolean;
}

/**
 * The one header for every surface. Server-rendered: it reads the session to
 * show the account menu. On small screens the links fold into a disclosure
 * menu (<details>, no JavaScript needed) — the installed PWA is used on
 * phones at community-board meetings as much as on desktops at City Hall.
 *
 * Public-plane labels come from the request's language catalog; staff and
 * product labels (admin, landing) are English because those pages only
 * exist in English (lib/i18n/routing.ts).
 */
export async function SiteHeader({ variant, tenant, family, familyView, org }: SiteHeaderProps) {
  const auth = hasDatabase() || !authConfigured() ? await getAuth() : null;
  const { m, href } = await getI18n();
  const tenantFamily = tenant && !family ? await familyForTenant(tenant.slug) : null;
  const shownFamily = family ?? tenantFamily;
  const tenantOrg = tenant ? await organizationOfTenant(tenant.slug) : null;
  const languageHelp = org?.languageHelp ?? shownFamily?.organization.languageHelp ?? tenantOrg?.languageHelp ?? null;
  const publicPlane = variant === 'tenant' || variant === 'org';

  const links: NavLink[] = [];
  if (variant === 'landing' || variant === 'account' || variant === 'architecture') {
    links.push({ href: '/pricing', label: 'Pricing' });
    if (auth?.userId) links.push({ href: '/account', label: 'My portraits' });
    links.push({ href: '/start', label: 'Start a portrait', primary: true });
  }
  if (variant === 'tenant' && tenant) {
    links.push({ href: href(`/${tenant.slug}/progress`), label: m.nav.progress });
    links.push({ href: href(`/${tenant.slug}/methodology`), label: m.nav.methodology });
    links.push({ href: href(`/${tenant.slug}/outreach`), label: m.nav.getInvolved });
    links.push({ href: href(`/${tenant.slug}/emergency`), label: m.emergency.navLabel });
  }
  if (variant === 'admin' && tenant) {
    const a = `/${tenant.slug}/admin`;
    links.push({ href: a, label: 'Overview' });
    links.push({ href: `${a}/review`, label: 'Review' });
    links.push({ href: `${a}/research`, label: 'Research' });
    links.push({ href: `${a}/policy`, label: 'Policy' });
    links.push({ href: `${a}/emergency`, label: 'Emergency' });
    links.push({ href: `${a}/members`, label: 'Members' });
    links.push({ href: `${a}/settings`, label: 'Settings' });
    if (tenantOrg) links.push({ href: `/o/${tenantOrg.slug}/billing`, label: 'Billing' });
    links.push({ href: `/${tenant.slug}`, label: 'Public site ↗' });
  }

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  const linkClass = (l: NavLink) =>
    l.primary
      ? 'rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-white hover:opacity-90'
      : 'rounded px-3 py-1.5 hover:bg-black/5';

  const accountControl =
    auth && !auth.devMode && hasDatabase() ? (
      auth.userId ? (
        <details className="relative">
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
        <Link
          href={`/login${tenant ? `?next=${encodeURIComponent(href(`/${tenant.slug}`))}` : ''}`}
          className="rounded border border-black/15 px-3 py-1.5 hover:bg-black/5"
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
          <span>deep-fryer</span>
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

        <nav aria-label={m.common.mainNav} className="ms-auto hidden items-center gap-1 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-1 text-sm md:ms-1">
          {publicPlane ? <LanguageSwitcher /> : null}
          {accountControl}
          {links.length > 0 ? (
            <details className="relative md:hidden">
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
                  <Link key={l.href} href={l.href} className="block rounded px-3 py-2.5 hover:bg-black/5">
                    {l.label}
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {variant !== 'landing' && shownFamily ? (
        <FamilyNav family={shownFamily} currentSlug={tenant?.slug} currentView={familyView} />
      ) : null}
      {publicPlane ? <LanguageNotice languageHelp={languageHelp} /> : null}
    </header>
  );
}
