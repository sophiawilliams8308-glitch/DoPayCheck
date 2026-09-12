import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * ESLint flat configuration.
 *
 * `eslint-config-next` v16 ships native flat-config arrays, so they are composed directly —
 * no `FlatCompat` shim is needed.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'next-env.d.ts',
      // Prisma-generated client: machine-written, not ours to lint.
      'lib/db/generated/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // Tax accuracy and type-safety rules (CLAUDE.md §4, §6; spec §2, §4).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Structured logging is the supported path; stray console output is not (spec §58).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Tests may use console freely.
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    // Command-line scripts report progress on stdout; the structured logger targets the
    // running application, not one-shot CLI tooling.
    files: ['prisma/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
