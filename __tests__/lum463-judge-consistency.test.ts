/**
 * @jest-environment node
 *
 * LUM-463 criterion 4 — the judge's reliability is MEASURED before it is
 * trusted. A k-run consistency evaluation over a fixture set of legit-update vs
 * weakening diffs runs each fixture k times and records the agreement (pass^k
 * discipline), rather than blindly trusting one non-deterministic call.
 */
import {
  evaluateJudgeConsistency,
  type ConsistencyReport,
} from '@/lib/boundary-crossing/judge-consistency'
import { JUDGE_CONSISTENCY_FIXTURES } from '@/lib/boundary-crossing/judge-fixtures'
import type { JudgeVerdict } from '@/lib/boundary-crossing/test-tampering-judge'

describe('LUM-463 judge consistency eval (criterion 4)', () => {
  it('LLM judge reliability is evaluated with a k-run consistency check on fixtures', async () => {
    const fixtures = JUDGE_CONSISTENCY_FIXTURES
    const k = 3

    // The fixture set covers BOTH classes — legit updates and weakenings.
    expect(fixtures.length).toBeGreaterThanOrEqual(4)
    expect(fixtures.some(f => f.expected === 'LEGIT')).toBe(true)
    expect(fixtures.some(f => f.expected === 'WEAKENING')).toBe(true)

    // 1) A perfectly consistent + correct judge → every fixture's k runs agree
    //    (pass^k = 1) and the majority matches the expected label.
    const oracle = new Map(fixtures.map(f => [f.input.testDiff, f.expected]))
    const perfect = jest.fn(
      async (input): Promise<JudgeVerdict> =>
        oracle.get(input.testDiff) ?? 'WEAKENING'
    )
    const report: ConsistencyReport = await evaluateJudgeConsistency(
      fixtures,
      k,
      perfect
    )

    // It ran every fixture k times — not a single call.
    expect(perfect).toHaveBeenCalledTimes(fixtures.length * k)
    expect(report.k).toBe(k)
    expect(report.fixtures).toBe(fixtures.length)
    expect(report.perFixture).toHaveLength(fixtures.length)
    for (const f of report.perFixture) {
      expect(f.runs).toHaveLength(k)
      expect(f.unanimous).toBe(true)
      expect(f.agreement).toBe(1)
      expect(f.matchedExpected).toBe(true)
    }
    expect(report.unanimousRate).toBe(1)
    expect(report.accuracy).toBe(1)

    // 2) A flaky judge that flips every call → no fixture's k runs agree, so the
    //    recorded consistency drops below 1 (the whole point of measuring).
    let n = 0
    const flaky = jest.fn(
      async (): Promise<JudgeVerdict> => (n++ % 2 === 0 ? 'LEGIT' : 'WEAKENING')
    )
    const flakyReport = await evaluateJudgeConsistency(fixtures, k, flaky)
    expect(flakyReport.unanimousRate).toBeLessThan(1)
    expect(flakyReport.perFixture.every(f => !f.unanimous)).toBe(true)
  })
})
