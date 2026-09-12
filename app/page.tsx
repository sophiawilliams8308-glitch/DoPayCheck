import type { Metadata } from 'next';

import { SITE, buildMetadata } from '@/lib/seo/metadata';

/**
 * Home page — Phase 1 foundation placeholder.
 *
 * Deliberately minimal. Spec §32 defines the real homepage (hero, calculator, trust strip,
 * 50-state links, guides, FAQ) and spec §33 the calculator itself; those are built in Phases
 * 9–11. No calculator, no tax values, no fabricated marketing content is created here.
 */

export const metadata: Metadata = buildMetadata({
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  path: '/',
  // Not indexable yet: there is no real content to index, and indexing a placeholder would
  // damage the domain's search reputation (spec §37).
  indexable: false,
});

export default function HomePage(): React.ReactElement {
  return (
    <main id="main-content">
      <h1>{SITE.name}</h1>
      <p>{SITE.tagline}</p>
      <p>
        This application is under active development. The paycheck calculator, tax rule engine and
        state pages are delivered in later phases.
      </p>
    </main>
  );
}
