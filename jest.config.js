const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/.worktrees/',
    '<rootDir>/.claude/worktrees/',
    '<rootDir>/.auto-claude/worktrees/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.worktrees/',
    '<rootDir>/.claude/worktrees/',
    '<rootDir>/.auto-claude/worktrees/',
  ],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'lib/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // LUM-735 v4: the `workflow` package is ESM-only (its `require` condition
    // is a TypeScript plugin) — stub it; see __stubs__/workflow.ts.
    '^workflow$': '<rootDir>/__stubs__/workflow.ts',
    '^workflow/api$': '<rootDir>/__stubs__/workflow-api.ts',
    // LUM-735 v5: `@vercel/sandbox` is ESM-only too; stage A reaches it
    // transitively, so every suite needs the stub — see __stubs__/vercel-sandbox.ts.
    '^@vercel/sandbox$': '<rootDir>/__stubs__/vercel-sandbox.ts',
  },
}

// `marked` ships pure ESM (type: module, no CJS build), which jest can't load
// as CommonJS. next/jest ignores node_modules from transformation by default
// AND overrides any `transformIgnorePatterns` passed in `customJestConfig`, so
// we await the generated config and override the field last — carving `marked`
// back in so SWC transpiles it. Without this, every suite that transitively
// imports `lib/utils/markdown.ts` (task.service, task-context.service, …) fails
// to LOAD with "Unexpected token 'export'".
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)()
  config.transformIgnorePatterns = [
    // htmlparser2 12 + its nested dom* / entities deps are ESM-only
    // (sanitize-html, LUM-916).
    '/node_modules/(?!(marked|lowlight|highlight\\.js|devlop|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
