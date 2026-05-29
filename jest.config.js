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
    '/node_modules/(?!(marked|@lobehub/icons)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
