import coreWebVitals from 'eslint-config-next/core-web-vitals'

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...coreWebVitals,
  {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'warn',
      'no-unused-vars': 'warn',
      'prefer-const': 'warn',
      'no-var': 'warn',
      'react/no-unescaped-entities': 'warn',
      'jsx-a11y/alt-text': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // New strict rules in react-hooks v7 — downgrade to warn until codebase is migrated
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    // The base rule can't read TypeScript: it flags parameter names inside
    // function *types* (`(runId: string) => void`) as unused variables. The
    // typescript-eslint version (already registered by eslint-config-next)
    // understands type positions and still reports real unused bindings.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // Layered architecture: the Service layer must not access Prisma directly.
    // Use runInTransaction from @/lib/db/transaction and the repositories in
    // @/lib/repositories. (@/lib/db/errors and @/lib/db/transaction stay allowed.)
    files: ['lib/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/db/prisma',
              message:
                'Services must not import the Prisma client. Use runInTransaction ' +
                'from @/lib/db/transaction and the repositories in @/lib/repositories.',
            },
          ],
        },
      ],
    },
  },
  {
    // LUM-785: semgrep rule fixtures are deliberately bad code, not sources.
    ignores: [
      'node_modules/',
      '.next/',
      'out/',
      'build/',
      'security/semgrep-rules/',
    ],
  },
]
