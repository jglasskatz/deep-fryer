import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@deep-fryer/core', '@deep-fryer/db'],
};

export default nextConfig;
