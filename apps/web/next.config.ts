import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
