/**
 * A small, self-contained Result type for the SEO domain.
 *
 * ===========================================================================
 * DELIBERATELY NOT IMPORTED FROM `lib/tax/*`.
 *
 * `lib/tax/state/rules/read-detail.ts` already has a `Read<T>`/`readOk`/`readFail` shape this
 * mirrors in spirit — but SEO code must never import from the tax domain except through the
 * one authorized boundary (`coverage.isPublishable()`, SEO-03 contract §F). Duplicating this
 * tiny type here keeps that boundary real instead of "true except for a shared utility."
 * ===========================================================================
 */

export type SeoResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SeoIssue[] };

export interface SeoIssue {
  readonly path: string;
  readonly message: string;
}

export function seoOk<T>(value: T): SeoResult<T> {
  return { ok: true, value };
}

export function seoFail<T>(issues: readonly SeoIssue[]): SeoResult<T> {
  return { ok: false, issues };
}
