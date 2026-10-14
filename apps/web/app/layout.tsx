import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { appUrl } from '@/lib/env';
import { LOCALES } from '@/lib/i18n/locales';
import { isLocalizablePath, localizeHref } from '@/lib/i18n/routing';
import { getI18n, getRequestPath } from '@/lib/i18n/server';
// Inter ships with the app (all Latin, Cyrillic, Greek and Vietnamese
// subsets, each loaded only when a page uses it) rather than through
// next/font/google: builds need no network access to Google, and the
// Russian / Polish / French language pages render in the same face. Scripts
// Inter lacks (Chinese, Korean, Bengali, Arabic, Urdu) fall back to the
// system fonts in --font-sans.
import '@fontsource-variable/inter';
import './globals.css';

const baseMetadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: 'deep-fryer — Doughnut Economics portraits for cities', template: '%s · deep-fryer' },
  description:
    'Sourced, reviewed Doughnut Economics portraits for municipalities: a public doughnut with evidence beside every number, progress against adopted goals, and a staff review queue.',
  applicationName: 'deep-fryer',
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
 * Pages that exist in every language list their translations (hreflang), so
 * search engines send a Spanish speaker to /es/… and the English page stays
 * the default. Pages may override title/description; alternates stay.
 */
export async function generateMetadata(): Promise<Metadata> {
  const path = (await getRequestPath()).split('?')[0]!;
  if (!isLocalizablePath(path)) return baseMetadata;
  const languages: Record<string, string> = { 'x-default': path };
  for (const l of LOCALES) languages[l.code] = localizeHref(l.code, path);
  const { locale } = await getI18n();
  return { ...baseMetadata, alternates: { canonical: localizeHref(locale, path), languages } };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2f7d32' },
    { media: '(prefers-color-scheme: dark)', color: '#1f5a22' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers makes every page dynamic, which the per-request
  // CSP nonce requires (middleware.ts); Next stamps the nonce on its scripts.
  await headers();
  const { info } = await getI18n();
  return (
    <html lang={info.code} dir={info.dir}>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
