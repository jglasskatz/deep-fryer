import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { appUrl } from '@/lib/env';
// Inter ships with the app (all Latin, Cyrillic, Greek and Vietnamese
// subsets, each loaded only when a page uses it) rather than through
// next/font/google: builds need no network access to Google, and the
// Russian / Polish / French language pages render in the same face. Scripts
// Inter lacks (Chinese, Korean, Bengali, Arabic, Urdu) fall back to the
// system fonts in --font-sans.
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
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
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
