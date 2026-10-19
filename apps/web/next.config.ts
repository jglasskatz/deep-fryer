import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-hosted Docker deploy (SPEC §4): standalone output traces the server
  // bundle; the monorepo root must be the tracing root so workspace packages
  // are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  transpilePackages: ['@deep-fryer/contract', '@deep-fryer/core', '@deep-fryer/db'],
  webpack: (config) => {
    // Workspace packages use TS-style ESM imports ('./schema.js' → schema.ts).
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  // Node-only libraries with dynamic requires: load them from node_modules at
  // runtime instead of bundling.
  serverExternalPackages: ['postgres', 'graphile-worker', 'nodemailer', 'stripe'],
  async headers() {
    return [
      {
        // The service worker must never be cached by HTTP caches, or a fixed
        // release could take a day to reach installed apps.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
      },
      {
        // The embed loader is fetched by third-party city sites.
        source: '/embed.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
  async redirects() {
    // The v3 NYC pitch shipped /compare and /insights as NYC-only pages; they
    // now live under the organization. Shared links keep working.
    return [
      { source: '/compare', destination: '/o/nyc/compare', permanent: false },
      { source: '/insights', destination: '/o/nyc/insights', permanent: false },
    ];
  },
};

export default nextConfig;
