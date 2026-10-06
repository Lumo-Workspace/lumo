/**
 * LUM-1011: Record 页上的用例汇总。拦截规则必须与服务端 DONE 闸
 * （done-verdict.service collectTestCasePlane，LUM-812）同一条：每条用例
 * **最新**一条 run 是未裁定的实现缺陷。
 */
import {
  deriveLatestVerdict,
  summarizeTestCases,
  type SummaryRun,
} from '@/lib/test-cases/case-summary'

const run = (over: Partial<SummaryRun> = {}): SummaryRun => ({
  id: 'r',
  result: 'PASS',
  environment: 'PRODUCTION',
  failureAttribution: null,
  unprovenVerification: [],
  evidence: [{ type: 'link', url: 'https://example.com' }],
  disposition: null,
  ...over,
})

describe('deriveLatestVerdict', () => {
  it('reads no run as NEVER_RUN', () => {
    expect(deriveLatestVerdict(null, null)).toBe('NEVER_RUN')
  })

  it('caps a pass recorded off its required environment to UNPROVEN', () => {
    expect(
      deriveLatestVerdict(run({ environment: 'LOCAL' }), 'PRODUCTION')
    ).toBe('UNPROVEN')
  })
})

describe('summarizeTestCases', () => {
  const defect = run({
    id: 'r-defect',
    result: 'FAIL',
    failureAttribution: 'IMPLEMENTATION_DEFECT',
  })

  it('counts verdicts and lists the latest undispositioned defect', () => {
    const s = summarizeTestCases([
      { number: 1, title: 'a', requiredEnvironment: null, runs: [run()] },
      {
        number: 2,
        title: 'b',
        requiredEnvironment: null,
        runs: [defect, run()],
      },
      { number: 3, title: 'c', requiredEnvironment: null, runs: [] },
      {
        number: 4,
        title: 'd',
        requiredEnvironment: null,
        runs: [run({ result: 'BLOCKED' })],
      },
    ])
    expect(s).toMatchObject({
      total: 4,
      passing: 1,
      failing: 1,
      notRun: 1,
      inconclusive: 1,
    })
    expect(s.blocking).toEqual([
      { caseNumber: 2, title: 'b', runId: 'r-defect' },
    ])
  })

  it('a ruled-on defect no longer blocks', () => {
    const s = summarizeTestCases([
      {
        number: 2,
        title: 'b',
        requiredEnvironment: null,
        runs: [{ ...defect, disposition: { disposition: 'KNOWN_DEFECT' } }],
      },
    ])
    expect(s.blocking).toEqual([])
  })

  it('only the latest run counts — an old defect under a newer pass does not block', () => {
    const s = summarizeTestCases([
      {
        number: 2,
        title: 'b',
        requiredEnvironment: null,
        runs: [run(), defect],
      },
    ])
    expect(s.blocking).toEqual([])
  })
})
