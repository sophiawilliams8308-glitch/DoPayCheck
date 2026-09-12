import type { NextConfig } from 'next';

import { securityHeaders } from './lib/security/headers';

/**
 * DoPayCheck — Next.js configuration.
 *
 * Architecture notes (spec §3, §37, §60, §62):
 * - ONE integrated full-stack application. There is no separate frontend/backend app.
 * - `output: 'export'` (static export) is deliberately NOT used: it would break API routes,
 *   server-side calculation, admin, database access, authentication and PDF generation
 *   (spec §62). The app must be able to run as a real Node server.
 * - `trailingSlash: true` matches the canonical URL examples in spec §36/§37
 *   (e.g. `/paycheck-calculator/california/`) and gives one consistent policy.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Consistent trailing-slash policy — see spec §37 "Consistent trailing slash policy".
  trailingSlash: true,

  // Do not leak the framework version in response headers.
  poweredByHeader: false,

  typescript: {
    // Never let a broken build through: type errors must fail the build.
    ignoreBuildErrors: false,
  },

  // NOTE: Next 16 removed the built-in `eslint` build integration. Linting runs as its own
  // quality gate via `npm run lint` (and in CI), not as part of `next build`.

  images: {
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
