import type { NextConfig } from 'next';

// Set NEXT_PUBLIC_BASE_PATH=/<repo-name> when hosting under a sub-path (GitHub Pages project site).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  // Pure static site: all data lives on the device, so no server is needed.
  output: 'export',
  basePath,
  trailingSlash: true,
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
