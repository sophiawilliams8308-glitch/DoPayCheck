import type { Metadata } from 'next';

import { buildMetadata } from '@/lib/seo/metadata';

/** 404 page (spec §37 requires an explicit 404). */
export const metadata: Metadata = buildMetadata({
  title: 'Page not found',
  description: 'The requested page could not be found.',
  path: '/404/',
  indexable: false,
});

export default function NotFound(): React.ReactElement {
  return (
    <main id="main-content">
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
    </main>
  );
}
