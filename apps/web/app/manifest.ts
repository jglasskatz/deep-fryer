import type { MetadataRoute } from 'next';

/**
 * Web app manifest (served at /manifest.webmanifest). Installable on phones
 * and desktops; opens to the home page, with shortcuts to the places staff
 * go most — their portraits and the sign-in page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'deep-fryer — city doughnut portraits',
    short_name: 'deep-fryer',
    // "Doughnut" is Kate Raworth's diagram, described rather than used as a
    // label, so nothing reads as DEAL's endorsement (docs/OPEN-SOURCE.md §3.2(5)).
    description:
      'Sourced, reviewed city portraits on Kate Raworth’s Doughnut of social and planetary boundaries, with progress against adopted goals.',
    // The plain home page, so an offline launch finds the copy the service
    // worker stored when the home page was visited. (It used to carry
    // ?source=pwa, which nothing read; iOS keeps the start URL it was
    // installed with, so public/sw.js also ignores `source` when it stores
    // or looks up a page.)
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#fafaf7',
    theme_color: '#2f7d32',
    categories: ['government', 'productivity', 'education'],
    lang: 'en-US',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'My portraits', short_name: 'Portraits', url: '/account', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Pricing', url: '/pricing' },
    ],
  };
}
