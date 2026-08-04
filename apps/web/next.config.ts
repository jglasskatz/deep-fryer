import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
