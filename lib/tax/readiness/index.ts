/**
 * Public surface of the tax readiness module for SEO consumption (contract §F).
 *
 * SEO code should import from here (or directly from `./coverage`), never from
 * `./repository` or `./fingerprint` — those are the tax domain's own internals.
 */
export { coverage, isPublishable, type PublishabilityResult } from './coverage';
