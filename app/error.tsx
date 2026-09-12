'use client';

import { useEffect } from 'react';

/**
 * Global error boundary.
 *
 * React error boundaries must be Client Components — this is the only client-side JavaScript
 * in the Phase 1 application.
 *
 * Security (spec §57): the caught error is NOT rendered. Next.js already strips server error
 * messages in production, but rendering `error.message` would risk leaking internal detail in
 * any environment. Only the opaque `digest` is shown, so a user can quote it in a support
 * request while the real message stays in server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Client-side visibility only; the authoritative record is the server log.
    console.error('Unhandled application error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <main id="main-content">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred. Please try again.</p>
      {error.digest !== undefined && <p>Reference: {error.digest}</p>}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
