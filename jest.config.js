const nextJest = require('next/jest')
const v8 = require('v8')

// LUM-940: disable V8's Sparkplug baseline compiler for every jest process.
// Node 24's V8 (13.6) has a GC bug in the Sparkplug out-of-line prologue: a
// major GC hitting that frame reads a junk stack slot as a heap pointer and the
// process dies with SIGSEGV in ClearStaleLeftTrimmedPointerVisitor — seen here
// as "A jest worker process … was terminated by another process:
// signal=SIGSEGV" on a random suite (or exit 139 with --runInBand).
// Upstream: https://github.com/nodejs/node/issues/62393 — V8 fix 0b94a9fd23ba,
// backported to v24.x-staging as fb0d0ca28993 (not in any 24.x release as of
// 2026-10-06). `--no-sparkplug` is rejected in NODE_OPTIONS, so:
//   - workers: jest-worker forks children with `process.execArgv`, so adding
//     the flag here makes every worker start with it;
//   - this (main) process — which runs the tests under --runInBand — gets it
//     at runtime, before any test code is compiled.
// Remove once a 24.x release containing fb0d0ca28993 is the local Node and
// `npx tsx scripts/jest-sparkplug-repro.ts --no-guard` (both --mode inband and
// --mode workers) shows 0 crashes on it.
if (!process.execArgv.includes('--no-sparkplug')) {
  process.execArgv.push('--no-sparkplug')
}
v8.setFlagsFromString('--no-sparkplug')

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
    // @clerk/mcp-tools only ships an ESM `import` condition; map the server
    // entry to its dist file (and carve it into transformIgnorePatterns below)
    // so tests can exercise the REAL verifyClerkToken (LUM-1047).
    '^@clerk/mcp-tools/server$':
      '<rootDir>/node_modules/@clerk/mcp-tools/dist/server.js',
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
    // better-auth 1.7 and its runtime deps are ESM-only too (LUM-1027).
    '/node_modules/(?!(marked|lowlight|highlight\\.js|devlop|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|better-auth|@better-auth|better-call|@better-fetch|jose|nanostores|@noble|kysely|rou3|uncrypto|defu|@clerk/mcp-tools)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
