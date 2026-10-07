import coreWebVitals from 'eslint-config-next/core-web-vitals'

// LUM-1021: blob SDKs are confined to lib/blob (the BlobStorage backends).
const BLOB_SDK_PATTERN = {
  group: ['@vercel/blob', '@vercel/blob/*', '@aws-sdk/*'],
  message:
    'Use getBlobStorage() from @/lib/blob/storage (LUM-1021); blob SDKs are ' +
    'only allowed inside lib/blob.',
}

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
          // Repeated from the LUM-1022 block below: flat-config rule options
          // replace rather than merge, so services must carry both restrictions.
          patterns: [
            {
              group: ['@vercel/functions', '@vercel/functions/*'],
              message:
                'Import waitUntil from @/lib/runtime/wait-until (LUM-1022); ' +
                '@vercel/functions is only allowed inside lib/runtime.',
            },
            BLOB_SDK_PATTERN,
          ],
        },
      ],
    },
  },
  {
    // LUM-1022: @vercel/functions is confined to lib/runtime so self-hosted
    // Node keeps working. Use waitUntil from @/lib/runtime/wait-until.
    // LUM-1021: likewise blob SDKs are confined to lib/blob.
    files: [
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
    ],
    ignores: ['lib/runtime/**', 'lib/services/**', 'lib/blob/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@vercel/functions', '@vercel/functions/*'],
              message:
                'Import waitUntil from @/lib/runtime/wait-until (LUM-1022); ' +
                '@vercel/functions is only allowed inside lib/runtime.',
            },
            BLOB_SDK_PATTERN,
          ],
        },
      ],
    },
  },
  {
    // The two wrapper folders each keep the other's restriction.
    files: ['lib/runtime/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BLOB_SDK_PATTERN] }],
    },
  },
  {
    files: ['lib/blob/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@vercel/functions', '@vercel/functions/*'],
              message:
                'Import waitUntil from @/lib/runtime/wait-until (LUM-1022); ' +
                '@vercel/functions is only allowed inside lib/runtime.',
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
      // Build output of the shared / cli workspaces.
      'shared/dist/',
      'cli/dist/',
      'cli/assets/',
      'security/semgrep-rules/',
      // Nested git worktrees (lumo worktree / Claude Code) are other checkouts.
      '.worktrees/',
      '.claude/worktrees/',
    ],
  },
]
