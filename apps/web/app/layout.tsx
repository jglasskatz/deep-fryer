import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { loginI18n } from '@/app/login/i18n';
import { isSignInPath } from '@/app/login/sign-in';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SupportEmailProvider } from '@/components/site-footer/SupportEmail';
import { DeepFryLayer } from '@/components/theme/DeepFryLayer';
import { deploymentFeatureOn } from '@/lib/features';
import { appUrl, supportEmail } from '@/lib/env';
import { languageAlternates } from '@/lib/i18n/alternates';
import { isLocalizablePath, localizeHref } from '@/lib/i18n/routing';
import { getI18n, getRequestPath } from '@/lib/i18n/server';
import { termsUrl } from '@/lib/site-settings';
import { THEME_CHROME_COLORS, THEME_INIT_SCRIPT } from '@/lib/theme';
import { translationOnFor } from '@/lib/translation-policy';
// Inter ships with the app (all Latin, Cyrillic, Greek and Vietnamese
// subsets, each loaded only when a page uses it) rather than through
// next/font/google: builds need no network access to Google, and the
// Russian / Polish / French language pages render in the same face. Scripts
// Inter lacks (Chinese, Korean, Bengali, Arabic, Urdu) fall back to the
// system fonts in --font-sans.
import '@fontsource-variable/inter';
import './globals.css';

/**
 * The social preview (public/social-preview.png, 1200×630, made from the app
 * icon's rings and the bundled Inter face, no external host). Every page
 * shares it; link previews take their title and description from the page's
 * own (Next fills og:title/og:description and the twitter:* tags from them),
 * so a shared portrait shows the portrait's name, not the product's.
 */
const SOCIAL_PREVIEW = {
  url: '/social-preview.png',
  width: 1200,
  height: 630,
  alt: 'deep-fryer: a doughnut chart of a city’s social foundation and ecological ceiling',
} as const;

/*
 * "Doughnut" here is the chart, credited in the footer to Kate Raworth and
 * Christian Guthier; the product name and copy never use "Doughnut
 * Economics" as a label or suggest DEAL's endorsement (docs/OPEN-SOURCE.md
 * §3.2(5)).
 */
const baseMetadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: 'deep-fryer — doughnut portraits for cities', template: '%s · deep-fryer' },
  description:
    'Sourced, reviewed city portraits on Kate Raworth’s Doughnut of social and planetary boundaries: a public doughnut with evidence beside every number, progress against adopted goals, and a staff review queue.',
  applicationName: 'deep-fryer',
  openGraph: { type: 'website', siteName: 'deep-fryer', images: [SOCIAL_PREVIEW] },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: 'deep-fryer', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

/**
 * The product's own pages that name their one URL as canonical (no
 * language versions; a shared link with ?utm_… or ?hl=… still points
 * search engines at the clean address). Other English-only pages — sign-in,
 * staff, account — are not indexed at all (app/robots.ts), and a 404 names
 * none (app/not-found.tsx).
 */
const CANONICAL_PRODUCT_PAGES = new Set(['/', '/pricing', '/accessibility', '/privacy']);

/**
 * Pages that exist in every language list their translations (hreflang), so
 * search engines send a Spanish speaker to /es/… and the English page stays
 * the default. Pages may override title/description; alternates stay.
 *
 * A portrait with translation off has English pages only (SPEC-v7 §3.5):
 * middleware redirects its /es/… URLs back to English, so listing them would
 * advertise eleven translations that do not exist. Those pages name only
 * their English URL. translationOnFor is the rule middleware routed this
 * request by; its answer is cached for a minute per portrait, and the
 * header's language switcher asks the same question, so this adds at most
 * one small query a minute.
 */
export async function generateMetadata(): Promise<Metadata> {
  const path = (await getRequestPath()).split('?')[0]!;
  if (!isLocalizablePath(path)) {
    return CANONICAL_PRODUCT_PAGES.has(path) ? { ...baseMetadata, alternates: { canonical: path } } : baseMetadata;
  }
  if (!(await translationOnFor(path))) return { ...baseMetadata, alternates: { canonical: path } };
  const { locale } = await getI18n();
  return { ...baseMetadata, alternates: { canonical: localizeHref(locale, path), languages: languageAlternates(path) } };
}

/**
 * The browser chrome follows the device by default; an explicit light or
 * dark choice pins one colour with an extra <meta> placed ahead of these
 * (lib/theme.ts applyThemeColorMeta, and THEME_INIT_SCRIPT before first
 * paint). [P] An installed iOS app keeps its status bar style: iOS reads
 * apple-mobile-web-app-status-bar-style only at launch.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_CHROME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_CHROME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers makes every page dynamic, which the per-request
  // CSP nonce requires (middleware.ts); Next stamps the nonce on its scripts,
  // and the theme script below carries it explicitly.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const requestPath = await getRequestPath();
  // The sign-in pages have no language prefix but speak the reader's
  // remembered language (app/login/i18n.ts): <html lang> follows, so their
  // localized title and header are not read out with English rules.
  const { info, m } = isSignInPath(requestPath) ? await loginI18n() : await getI18n();
  // Embeds render inside a city's own page, whose theme this frame cannot
  // see; they stay light rather than turning dark inside a light host page
  // on a reader's dark device. [P] A host opt-in (data-theme on the loader)
  // would be the way to offer dark embeds.
  const embed = requestPath.startsWith('/embed/');
  const support = supportEmail();
  return (
    // suppressHydrationWarning: the theme script sets data-theme on <html>
    // before React hydrates (one level deep — children are still checked).
    <html lang={info.code} dir={info.dir} data-theme={embed ? 'light' : undefined} suppressHydrationWarning>
      <head>
        {embed ? null : (
          // Dark mode before first paint (lib/theme.ts THEME_INIT_SCRIPT): a
          // static string, no request data. suppressHydrationWarning because
          // browsers blank a nonce attribute once parsed (it stays readable
          // only as the .nonce property), which React reports as a mismatch.
          <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        )}
      </head>
      <body className="min-h-screen antialiased">
        <SupportEmailProvider email={support}>
          {embed ? (
            children
          ) : (
            // The footer (contact, accessibility, privacy, terms, the Doughnut
            // credit) sits at the bottom of the window on a short page and
            // after the content on a long one. The page itself goes in a
            // plain block, not a flex item: its `mx-auto max-w-…` mains would
            // shrink to their content as flex items. Embeds have no footer —
            // they carry the credit themselves, inside the city's page.
            <div className="flex min-h-screen flex-col">
              <div className="flex-1">{children}</div>
              <SiteFooter labels={m.footer} supportEmail={support} termsUrl={termsUrl()} />
            </div>
          )}
        </SupportEmailProvider>
        <ServiceWorkerRegistrar labels={{ updateAvailable: m.common.updateAvailable, reload: m.common.reload }} />
        {/* The deep fry is a deployment feature (SPEC-v7 §3, DF_DISABLED_FEATURES=deep_fry); the theme
            menu hides its item by the same check, and the fried state is never persisted, so nothing
            is left half-fried when an operator turns it off. */}
        {embed || !deploymentFeatureOn('deep_fry') ? null : <DeepFryLayer fried={m.theme.fried} unfried={m.theme.unfried} />}
      </body>
    </html>
  );
}
