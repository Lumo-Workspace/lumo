/** @jest-environment node */
import { classifyClaimFaithfulness } from '@/lib/claim-faithfulness/classify'
import type { TaskDelivery } from '@/lib/claim-faithfulness/types'

const delivery: TaskDelivery = {
  identifier: 'LUM-540',
  shas: ['a', 'b'],
  prNumbers: [635, 640],
  diff: 'diff --git a/lib/x.ts ...',
  commitSubjects: ['feat [LUM-540] (#635)'],
  changedFiles: ['lib/x.ts'],
  additions: 90,
  deletions: 4,
}

describe('classifyClaimFaithfulness', () => {
  it('returns UNJUDGEABLE without calling the judge when delivery is null', async () => {
    const judge = jest.fn()
    const r = await classifyClaimFaithfulness(
      { claim: 'did stuff', delivery: null },
      { judge }
    )
    expect(r.verdict).toBe('UNJUDGEABLE')
    expect(judge).not.toHaveBeenCalled()
  })

  it('returns UNJUDGEABLE without the judge when claim is null', async () => {
    const judge = jest.fn()
    const r = await classifyClaimFaithfulness(
      { claim: null, delivery },
      { judge }
    )
    expect(r.verdict).toBe('UNJUDGEABLE')
    expect(judge).not.toHaveBeenCalled()
  })

  it('runs the judge for every delivery+claim and surfaces prefilter + diffScope', async () => {
    const judge = jest.fn().mockResolvedValue({
      verdict: 'UNDERREPORT',
      evidence: ['lib/x.ts'],
      reasoning: 'r',
    })
    const r = await classifyClaimFaithfulness(
      { claim: '未包含代码变更', delivery },
      { judge }
    )
    expect(judge).toHaveBeenCalledTimes(1)
    expect(r.verdict).toBe('UNDERREPORT')
    expect(r.prefilterSignal).toBe('UNDERREPORT_CANDIDATE')
    expect(r.diffScope).toBe(2)
  })

  it('falls back to UNJUDGEABLE when the judge throws/times out', async () => {
    const judge = jest.fn().mockRejectedValue(new Error('timeout'))
    const r = await classifyClaimFaithfulness(
      { claim: 'refactored x', delivery },
      { judge }
    )
    expect(r.verdict).toBe('UNJUDGEABLE')
    expect(r.reasoning).toMatch(/judge (error|timeout|unavailable)/i)
  })
})
