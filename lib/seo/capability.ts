/**
 * SEO's own view of a capability code: an OPAQUE STRING (contract §S.2 — "the existing Phase 5
 * capability vocabulary only — no second vocabulary").
 *
 * Deliberately NOT `import type { CapabilityCode } from '@/lib/tax/state/resolutionContext'`.
 * That is a tax-domain module; importing it here — even for a type-only string alias — would
 * put `lib/seo/**` one import away from reaching into `lib/tax/state/**` for something more
 * (a scanner test enforces this stays zero). `SeoPage.requiredCapabilities` is already a plain
 * `String[]` in the database (contract §D.6) for the same reason: SEO carries the capability
 * key as data it passes through to `coverage.isPublishable()` — which validates and interprets
 * it on the tax-domain side of the boundary — never as a type it understands the members of.
 */
export type CapabilityCode = string;
