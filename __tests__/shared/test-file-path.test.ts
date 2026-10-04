/**
 * LUM-873 — the single test-file rule: `.test.` / `.spec.` only before a code
 * extension, plus Go / Python / Ruby conventions and test directories.
 */
import {
  TEST_FILE_TARGET,
  isTestFilePath,
} from '../../shared/src/test-file-path'

describe('isTestFilePath', () => {
  it('counts test files by language convention and test directories', () => {
    for (const path of [
      'lib/a.test.ts',
      'lib/a.spec.tsx',
      'web/a.test.mjs',
      'web/a.spec.cjs',
      'e2e/login.e2e.spec.ts',
      'pkg/billing_test.go',
      'app/test_billing.py',
      'test_billing.py',
      'app/billing_test.py',
      'spec/models/user_spec.rb',
      'lib/user_test.rb',
      'src/Foo.test.java',
      '__tests__/fixtures/data.json',
      'tests/fixtures/data.json',
      'test/helper.js',
      'spec/support/x.yml',
      '__tests__',
      'tests',
    ])
      expect([path, isTestFilePath(path)]).toEqual([path, true])
  })

  it('does not count look-alike configs, specs and env files', () => {
    for (const path of [
      'openapi.spec.yaml',
      'api.spec.json',
      '.env.test.local',
      'foo.test.config.js',
      'docs/superpowers/specs/plan.md',
      'lib/testing.ts',
      'lib/contest.ts',
      'lib/latest/x.ts',
      'lib/tests.ts',
      'scripts/jest-t.ts',
      'my_test_data.csv',
      'lib/attest_x.py',
    ])
      expect([path, isTestFilePath(path)]).toEqual([path, false])
  })

  it('matches shell tokens that end in a quote or operator', () => {
    expect(TEST_FILE_TARGET.test('"lib/a.test.ts"')).toBe(true)
    expect(TEST_FILE_TARGET.test("'pkg/x_test.go'")).toBe(true)
    expect(TEST_FILE_TARGET.test('openapi.spec.yaml"')).toBe(false)
  })
})
