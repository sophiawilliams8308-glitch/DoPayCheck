import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Phase 1 establishes the harness only. The directory layout below is the boundary future
 * phases build on (spec §61):
 *   tests/unit/        — pure, fast, no IO
 *   tests/integration/ — DB / route level (added when those exist)
 *   tests/golden/      — verified, source-based tax fixtures (Phase 4+)
 *   tests/e2e/         — full browser flows (Phase 12)
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
