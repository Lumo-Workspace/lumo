/** @jest-environment node */
import { evaluateSemgrepTest } from '@/scripts/security/semgrep-rules-test'

describe('LUM-785 semgrep-rules-test checkpointer', () => {
  it('passes only when every rule check passed and nothing is missing', () => {
    expect(
      evaluateSemgrepTest({
        results: { 'r.yaml': { checks: { a: { passed: true, errors: [] } } } },
      })
    ).toEqual([])
  })

  it('fails on a failed check, a rule file without fixtures, a config error, or zero checks', () => {
    expect(
      evaluateSemgrepTest({
        results: {
          'r.yaml': {
            checks: {
              a: {
                passed: false,
                matches: {
                  'r.ts': { expected_lines: [3], reported_lines: [] },
                },
              },
            },
          },
        },
      })
    ).toEqual(['r.yaml › a: FAILED (expected [3] reported [])'])
    expect(
      evaluateSemgrepTest({ config_missing_tests: ['x.yaml'], results: {} })
    ).toEqual([
      'rule file has no fixture: x.yaml',
      'no rule checks ran (empty results)',
    ])
    expect(
      evaluateSemgrepTest({
        config_with_errors: [{ filename: 'x.yaml', error: 'bad' }],
      })
    ).toEqual([
      'config error in x.yaml: bad',
      'no rule checks ran (empty results)',
    ])
    expect(evaluateSemgrepTest({})).toEqual([
      'no rule checks ran (empty results)',
    ])
  })
})
