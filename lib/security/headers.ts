/**
 * Baseline HTTP security headers (spec §57).
 *
 * Applied to every route via `next.config.ts`.
 *
 * PENDING DECISION — Content-Security-Policy.
 *   A strict CSP is intentionally NOT enabled in Phase 1. Getting it right requires a
 *   nonce/hash strategy for Next's inline bootstrap scripts, and the final policy depends on
 *   decisions not yet made: advertising (spec §45), analytics, and embedded third-party
 *   scripts. Shipping a permissive `unsafe-inline` CSP now would provide the appearance of
 *   protection without the substance. This must be revisited before production (Phase 12).
 */

export interface HttpHeader {
  readonly key: string;
  readonly value: string;
}

export function securityHeaders(): HttpHeader[] {
  const headers: HttpHeader[] = [
    // Block MIME-type sniffing.
    { key: 'X-Content-Type-Options', value: 'nosniff' },

    // Clickjacking protection.
    { key: 'X-Frame-Options', value: 'DENY' },

    // Limit referrer leakage to third parties.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

    // Deny powerful browser features this product does not use.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },

    // Isolate the browsing context.
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ];

  // HSTS is only meaningful over HTTPS and would be harmful on local http://localhost.
  if (process.env.NODE_ENV === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }

  return headers;
}
