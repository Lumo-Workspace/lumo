/**
 * LUM-405 follow-up: zero-match guard for jest test-name checkpointers.
 *
 * `npx jest -t '<name>'` exits 0 on zero matches, so a renamed/deleted test
 * silently fake-PASSes a MACHINE checkpointer. scripts/jest-t.ts fails that
 * case; these tests pin the decision core.
 */
import { evaluateJestCounts, extractJestJson } from '../jest-t'

describe('jest-t zero-match guard', () => {
  it('jest-t guard fails a zero-match run instead of fake-passing', () => {
    const verdict = evaluateJestCounts(
      { numPassedTests: 0, numFailedTests: 0 },
      'renamed test'
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.summary).toContain('ZERO tests matched')
  })

  it('jest-t guard passes when at least one matching test passed', () => {
    expect(
      evaluateJestCounts({ numPassedTests: 1, numFailedTests: 0 }, 'x').ok
    ).toBe(true)
    expect(
      evaluateJestCounts({ numPassedTests: 3, numFailedTests: 0 }, 'x').ok
    ).toBe(true)
  })

  it('jest-t guard fails when any matching test failed', () => {
    const verdict = evaluateJestCounts(
      { numPassedTests: 2, numFailedTests: 1 },
      'x'
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.summary).toContain('1 failed')
  })

  it('jest-t guard parses the jest JSON object out of noisy stdout', () => {
    const stdout =
      'some banner\n{"numPassedTests":2,"numFailedTests":0,"other":true}\ntrailer'
    expect(extractJestJson(stdout)).toEqual({
      numPassedTests: 2,
      numFailedTests: 0,
    })

    expect(() => extractJestJson('no json here')).toThrow('no JSON object')
    expect(() => extractJestJson('{"unrelated":1}')).toThrow(
      'missing test counters'
    )
  })
})
