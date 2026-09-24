import type {
  SeoBlockType,
  SeoIndexabilityReason,
  SeoLifecycleState,
  SeoPageTypeKey,
} from '@/lib/db/generated/index';

export type { SeoBlockType, SeoIndexabilityReason, SeoLifecycleState, SeoPageTypeKey };

/**
 * Shared SEO domain types (SEO-03 contract §D, §G, §H).
 *
 * NOTHING here imports `TaxRule`, `TaxRule.verificationStatus`, or any state rule/formula
 * module. The one tax-domain dependency this whole SEO tree is permitted is the
 * `coverage.isPublishable()` boundary (`lib/tax/readiness/`), consumed as an opaque
 * async function — never its internals.
 */

/** The five inheritance levels, outermost first (contract §H.1). */
export const InheritanceLevel = {
  GLOBAL: 'GLOBAL',
  PAGE_TYPE: 'PAGE_TYPE',
  TEMPLATE: 'TEMPLATE',
  CONTEXT: 'CONTEXT',
  PAGE: 'PAGE',
} as const;

export type InheritanceLevel = (typeof InheritanceLevel)[keyof typeof InheritanceLevel];

/**
 * The result of resolving one inheritable field: the effective value plus which level
 * supplied it — required by every admin display per contract §H.4, even though SEO-04 builds
 * no admin UI itself.
 */
export interface EffectiveField<T> {
  /** `null` when every level was absent (contract §H.2) — never coerced to a fallback here. */
  readonly value: T | null;
  readonly source: InheritanceLevel | 'ABSENT';
}

/** The fixed token vocabulary (contract §G.3). No other token is ever valid. */
export const SEO_TOKENS = [
  'state',
  'state_abbr',
  'amount',
  'amount_formatted',
  'tax_year',
  'calculator',
  'site',
] as const;

export type SeoToken = (typeof SEO_TOKENS)[number];

/** Values available to substitute tokens for one resolution — supplied by the caller, never
 * derived by the token module itself (it has no database access). */
export type TokenValues = Readonly<Partial<Record<SeoToken, string>>>;

/**
 * A resolved, effective view of a page's own inheritable fields — the input the resolver's
 * output stage (title/description/H1/canonical/etc.) consumes. `title`/`description`/`h1` are
 * always the RAW template text (with tokens still unresolved) at this stage; token
 * substitution is a separate step (contract §G.3), so a validation error on an unknown token
 * can be attributed to the field that contains it.
 */
export interface EffectiveSeoFields {
  readonly title: EffectiveField<string>;
  readonly description: EffectiveField<string>;
  readonly h1: EffectiveField<string>;
  readonly ogImagePath: EffectiveField<string>;
}

/** Non-removable block types (contract §D.7, §S.3). `LOCAL_TAX_NOTICE` is conditional — see
 * `lib/tax/readiness` for how "the jurisdiction has local taxes" is determined; SEO itself
 * never decides this from tax rule data. */
export const NON_REMOVABLE_BLOCK_TYPES: ReadonlySet<SeoBlockType> = new Set([
  'DISCLAIMER',
  'LOCAL_TAX_NOTICE',
]);

/** Structured-data types this project ever emits (contract §O). A closed allowlist — nothing
 * else may be requested by `SeoPageTypeConfig.defaultStructuredDataTypes`. */
export const ALLOWED_STRUCTURED_DATA_TYPES = [
  'Organization',
  'WebSite',
  'BreadcrumbList',
  'FAQPage',
  'Article',
] as const;

export type StructuredDataType = (typeof ALLOWED_STRUCTURED_DATA_TYPES)[number];
