import type { Metadata, Viewport } from 'next';

import { SITE, canonicalUrl, siteUrl } from '@/lib/seo/metadata';

import './globals.css';

/**
 * Root layout.
 *
 * Accessibility foundation (spec §59): explicit `lang`, a skip link to the main landmark,
 * and semantic landmarks. Focus visibility and reduced-motion handling live in globals.css.
 *
 * Performance foundation (spec §60): this is a Server Component and ships no client
 * JavaScript of its own. No `"use client"` boundary exists anywhere in Phase 1.
 */

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: canonicalUrl('/') },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Do not block user zoom — restricting it is an accessibility failure (spec §59).
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
