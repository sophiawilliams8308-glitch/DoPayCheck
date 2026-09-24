import { CALCULATOR_REGISTRY } from './registry';

/**
 * Calculator URL redirects (SEO-05 contract §22, owner decision record §54).
 *
 * ===========================================================================
 * OQ-3 PAIR A — RESOLVED CONSOLIDATE.
 *
 * Owner decision: `/take-home-pay-calculator/` is canonical; `/net-pay-calculator/` is a
 * permanent redirect to it. `/net-pay-calculator/` is deliberately NOT a `CalculatorKey`
 * (`./registry.ts`) and never gets its own `SeoPage` — it has no calculator identity of its
 * own, only a redirect target (contract §22: "must never become the canonical").
 *
 * Consumed by `next.config.ts`'s `redirects()` — a server-side, permanent (301) redirect, per
 * contract §22 ("do not use client-side JavaScript redirects for canonical consolidation").
 * This is the one place a legacy calculator path maps to its canonical replacement; nothing
 * else in the codebase should special-case `/net-pay-calculator/`.
 * ===========================================================================
 */

export interface CalculatorRedirect {
  readonly source: string;
  readonly destination: string;
  readonly permanent: true;
}

export const CALCULATOR_REDIRECTS: readonly CalculatorRedirect[] = [
  {
    source: '/net-pay-calculator/',
    destination: CALCULATOR_REGISTRY['take-home-pay'].canonicalPath,
    permanent: true,
  },
];
