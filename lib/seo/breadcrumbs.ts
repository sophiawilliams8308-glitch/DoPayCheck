import type { SeoPageTypeKey } from './types';

/**
 * Breadcrumb trail (SEO-03 contract §P).
 *
 * ===========================================================================
 * ONE DETERMINISTIC SOURCE — feeds both the visible trail and `BreadcrumbList` JSON-LD
 * (`lib/seo/structured-data.ts`). Two sources would eventually disagree, so there is exactly
 * one function, called by both.
 *
 * Deterministic from page identity alone: given the same page-type + label + path, the trail
 * is always identical. No database access.
 * ===========================================================================
 */

export interface BreadcrumbEntry {
  readonly label: string;
  readonly path: string;
}

export interface BreadcrumbInput {
  readonly pageType: SeoPageTypeKey;
  /** This page's own canonical path — the final crumb always points here. */
  readonly path: string;
  /** The page's own display label — state name, calculator name, guide title, hub name.
   * Ignored for HOME (no trail) and derived for SALARY (see `amountLabel`). */
  readonly label?: string;
  /** For SALARY pages: the formatted amount, e.g. `"$50,000"`, used to build the final crumb
   * label `"$50,000 After Taxes"` per the contract's own exact wording. */
  readonly amountLabel?: string;
}

const HOME: BreadcrumbEntry = { label: 'Home', path: '/' };
const PAYCHECK_CALCULATOR: BreadcrumbEntry = {
  label: 'Paycheck Calculator',
  path: '/paycheck-calculator/',
};
const GUIDES: BreadcrumbEntry = { label: 'Guides', path: '/guides/' };
/** No dedicated hub URL is enumerated for salary pages in the URL architecture (spec §36) —
 * `/salary/` is the natural interior node implied by `/salary/{amount}-after-taxes/`. */
const SALARY: BreadcrumbEntry = { label: 'Salary', path: '/salary/' };

/**
 * Resolves the breadcrumb trail for one page (contract §P's table):
 *   HOME       → none
 *   CALCULATOR → Home → Paycheck Calculator → {Calculator}
 *   STATE      → Home → Paycheck Calculator → {State}
 *   SALARY     → Home → Salary → ${Amount} After Taxes
 *   GUIDE      → Home → Guides → {Guide}
 *   HUB        → Home → {Hub}
 *   UTILITY    → Home → {label}, when a label is supplied; otherwise Home alone
 */
export function resolveBreadcrumbTrail(input: BreadcrumbInput): readonly BreadcrumbEntry[] {
  const self: BreadcrumbEntry = {
    label:
      input.pageType === 'SALARY' ? `${input.amountLabel ?? ''} After Taxes` : (input.label ?? ''),
    path: input.path,
  };

  switch (input.pageType) {
    case 'HOME':
      return [];
    case 'CALCULATOR':
      return [HOME, PAYCHECK_CALCULATOR, self];
    case 'STATE':
      return [HOME, PAYCHECK_CALCULATOR, self];
    case 'SALARY':
      return [HOME, SALARY, self];
    case 'GUIDE':
      return [HOME, GUIDES, self];
    case 'HUB':
      return [HOME, self];
    case 'UTILITY':
      return input.label === undefined ? [HOME] : [HOME, self];
    default:
      return input.pageType satisfies never;
  }
}
