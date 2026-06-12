/**
 * @jest-environment node
 *
 * LUM-463 criterion 2 — the LLM judge is cost-bounded: it runs ONLY on the
 * ambiguous residual the deterministic pre-filter could not decide, it is fed
 * the test-diff + code-diff + backing criterion, and its verdict sets the
 * outcome (LEGIT → downgrade, WEAKENING → flag). For any case the pre-filter
 * already decided, the judge is never called.
 */
import {
  classifyTestTampering,
  type JudgeVerdict,
  type JudgeInput,
} from '@/lib/boundary-crossing/test-tampering-judge'
import type { PrefilterInput } from '@/lib/boundary-crossing/test-tampering-prefilter'

const judgeInput: JudgeInput = {
  testDiff: 'expect(x).toBe(4) -> expect(x).toBe(5)',
  codeDiff: 'price = price * 1.1',
  criterion: 'prices include the new surcharge',
}

// Ambiguous: not weakened, but no positive legit reason (test-only, no spec edit).
const ambiguous: PrefilterInput = {
  oldString: 'expect(x).toBe(4)',
  newString: 'expect(x).toBe(5)',
  productionCodeCoChanged: false,
  backingCriterionChanged: false,
}

// Clear LEGIT (value change + code co-changed).
const clearLegit: PrefilterInput = {
  oldString: 'expect(x).toBe(4)',
  newString: 'expect(x).toBe(5)',
  productionCodeCoChanged: true,
  backingCriterionChanged: false,
}

// Clear WEAKENING (assertion loosened, test-only, no spec edit).
const clearWeakening: PrefilterInput = {
  oldString: 'expect(x).toBe(4)',
  newString: 'expect(x).toBeDefined()',
  productionCodeCoChanged: false,
  backingCriterionChanged: false,
}

describe('LUM-463 Stage-2 LLM judge — cost-bounded residual (criterion 2)', () => {
  it('LLM judge is invoked only on the ambiguous residual and its verdict sets the disposition', async () => {
    // 1) AMBIGUOUS → the judge IS called, once, with the full context, and its
    //    verdict drives the outcome. A "legit" verdict downgrades.
    const legitJudge = jest.fn(async (): Promise<JudgeVerdict> => 'LEGIT')
    const r1 = await classifyTestTampering(ambiguous, judgeInput, {
      judge: legitJudge,
    })
    expect(legitJudge).toHaveBeenCalledTimes(1)
    expect(legitJudge).toHaveBeenCalledWith(judgeInput)
    expect(r1).toEqual({ outcome: 'LEGIT', stage: 'LLM' })

    // 1b) AMBIGUOUS + a "weakening" verdict → flag.
    const weakeningJudge = jest.fn(
      async (): Promise<JudgeVerdict> => 'WEAKENING'
    )
    const r2 = await classifyTestTampering(ambiguous, judgeInput, {
      judge: weakeningJudge,
    })
    expect(weakeningJudge).toHaveBeenCalledTimes(1)
    expect(r2).toEqual({ outcome: 'WEAKENING', stage: 'LLM' })

    // 2) CLEAR cases → the judge is NEVER called (cost-bounded).
    const neverJudge = jest.fn(async (): Promise<JudgeVerdict> => 'LEGIT')
    const legit = await classifyTestTampering(clearLegit, judgeInput, {
      judge: neverJudge,
    })
    expect(legit).toEqual({ outcome: 'LEGIT', stage: 'PREFILTER' })
    const weak = await classifyTestTampering(clearWeakening, judgeInput, {
      judge: neverJudge,
    })
    expect(weak).toEqual({ outcome: 'WEAKENING', stage: 'PREFILTER' })
    expect(neverJudge).not.toHaveBeenCalled()
  })
})
