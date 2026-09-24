import { findBySlug } from '@/lib/jurisdictions/repository';
import { getPrisma } from '@/lib/db/client';

import type { SeoPage } from '@/lib/db/generated/index';

/**
 * Programmatic route resolution FOUNDATION (SEO-03 contract §R, §35).
 *
 * ===========================================================================
 * REUSABLE INFRASTRUCTURE ONLY — NO ROUTE FILES, NO CONTENT ROLLOUT.
 *
 * SEO-04 builds the lookup functions a future `app/paycheck-calculator/[state]/page.tsx` (and
 * its `/salary/[amount]-after-taxes/`, `/guides/[slug]/` counterparts) would call — it does
 * NOT create those route files, does not populate any `SeoPage` row, and does not implement
 * `generateStaticParams()` anywhere. Doing so is explicitly out of scope (state/salary/
 * calculator page rollout is SEO-05/06/07).
 *
 * `/paycheck-calculator/{state}/` resolves through the EXISTING `Jurisdiction.slug` /
 * `lib/jurisdictions/repository.ts` (contract §C: "sole jurisdiction identity") — never a
 * second jurisdiction lookup.
 * ===========================================================================
 *
 * "No page record ⇒ 404. Record exists but not PUBLISHED ⇒ 404 in production; visible in
 * preview to authorized users" (contract §R). This module returns the row (or `null`) and
 * `isRouteVisibleInProduction()`; the 404-vs-render decision itself belongs to the route file
 * that does not exist yet.
 */

export interface RouteResolution {
  readonly page: SeoPage;
  readonly jurisdictionId: string | null;
}

/** `/paycheck-calculator/{state}/` — resolves the jurisdiction via the existing repository,
 * then the one `SeoPage` row for it. `null` when either lookup misses — a 404, never a 200
 * with empty content (contract §R: "not a 200 with empty content, which would be a thin
 * page"). */
export async function resolveStatePageRoute(stateSlug: string): Promise<RouteResolution | null> {
  const jurisdiction = await findBySlug(stateSlug);
  if (jurisdiction === null) {
    return null;
  }
  const page = await getPrisma().seoPage.findFirst({
    where: { pageType: 'STATE', jurisdictionId: jurisdiction.id },
  });
  if (page === null) {
    return null;
  }
  return { page, jurisdictionId: jurisdiction.id };
}

/** `/salary/{amount}-after-taxes/` — `amount` must already be a validated non-negative
 * integer (contract §T: "one form only"); this function does no parsing of a URL segment. */
export async function resolveSalaryPageRoute(amount: number): Promise<RouteResolution | null> {
  if (!Number.isInteger(amount) || amount < 0) {
    return null;
  }
  const page = await getPrisma().seoPage.findFirst({
    where: { pageType: 'SALARY', salaryAmount: amount },
  });
  return page === null ? null : { page, jurisdictionId: null };
}

/** `/guides/{slug}/`. */
export async function resolveGuidePageRoute(slug: string): Promise<RouteResolution | null> {
  const page = await getPrisma().seoPage.findFirst({
    where: { pageType: 'GUIDE', guideSlug: slug },
  });
  return page === null ? null : { page, jurisdictionId: page.jurisdictionId };
}

/** `/{calculatorKey}/`-style calculator routes. */
export async function resolveCalculatorPageRoute(
  calculatorKey: string,
): Promise<RouteResolution | null> {
  const page = await getPrisma().seoPage.findFirst({
    where: { pageType: 'CALCULATOR', calculatorKey },
  });
  return page === null ? null : { page, jurisdictionId: null };
}

/**
 * Production visibility (contract §R): a record that exists but is not `PUBLISHED` is a 404
 * in production, visible only in preview to authorized users. This project's SEO-04 scope
 * builds no preview mode or authorization check (no admin exists yet) — this function answers
 * only the production half of that rule; a future preview path is a separate, later decision.
 */
export function isRouteVisibleInProduction(resolution: RouteResolution): boolean {
  return resolution.page.lifecycleState === 'PUBLISHED';
}
