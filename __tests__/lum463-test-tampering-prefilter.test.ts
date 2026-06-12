/**
 * @jest-environment node
 *
 * LUM-463 criterion 1 — the deterministic Stage-1 pre-filter classifies the
 * CLEAR cases on its own, with NO LLM call:
 *
 *  - a TEST_TAMPERING edit that does NOT weaken the assertions and is
 *    accompanied by a legit reason (production code co-changed in the same
 *    change-set, OR the backing criterion was itself edited) is classified
 *    LEGIT → downgraded;
 *  - a test-only edit that removes/loosens assertions or deletes test cases,
 *    with no production co-change and no criterion edit, is classified
 *    WEAKENING → flagged.
 *
 * In every clear case the LLM judge MUST NOT be invoked (cost-bounded).
 */
import {
  classifyTestTamperingPrefilter,
  assertionsWeakened,
  type PrefilterInput,
} from '@/lib/boundary-crossing/test-tampering-prefilter'
import {
  classifyTestTampering,
  type JudgeVerdict,
  type JudgeInput,
} from '@/lib/boundary-crossing/test-tampering-judge'

const judgeInput: JudgeInput = {
  testDiff: 'irrelevant for clear cases',
  codeDiff: null,
  criterion: 'a criterion',
}

// A spy judge that fails loudly if the pre-filter ever defers a clear case to it.
function spyJudge() {
  return jest.fn(async (): Promise<JudgeVerdict> => 'LEGIT')
}

describe('LUM-463 Stage-1 deterministic pre-filter (criterion 1)', () => {
  it('deterministic pre-filter downgrades legit-shaped test changes and flags weakening ones without the LLM', async () => {
    const judge = spyJudge()

    // --- legit shape #1: value changed (strength preserved) + code co-changed
    const legitCoChange: PrefilterInput = {
      oldString: "it('adds', () => { expect(add(2, 2)).toBe(4) })",
      newString: "it('adds', () => { expect(add(2, 2)).toBe(5) })",
      productionCodeCoChanged: true,
      backingCriterionChanged: false,
    }
    expect(classifyTestTamperingPrefilter(legitCoChange)).toBe('LEGIT')
    expect(
      (await classifyTestTampering(legitCoChange, judgeInput, { judge }))
        .outcome
    ).toBe('LEGIT')

    // --- legit shape #2: value changed + backing criterion was edited (spec moved)
    const legitCriterionChange: PrefilterInput = {
      oldString: "it('prices', () => { expect(price(x)).toBe(10) })",
      newString: "it('prices', () => { expect(price(x)).toBe(12) })",
      productionCodeCoChanged: false,
      backingCriterionChanged: true,
    }
    expect(classifyTestTamperingPrefilter(legitCriterionChange)).toBe('LEGIT')
    const legit2 = await classifyTestTampering(
      legitCriterionChange,
      judgeInput,
      {
        judge,
      }
    )
    expect(legit2.outcome).toBe('LEGIT')
    expect(legit2.stage).toBe('PREFILTER')

    // --- weakening shape #1: an assertion was removed (test-only, no spec move)
    const removedAssertion: PrefilterInput = {
      oldString:
        "it('adds', () => { expect(add(2, 2)).toBe(4); expect(typeof add).toBe('function') })",
      newString: "it('adds', () => { expect(typeof add).toBe('function') })",
      productionCodeCoChanged: false,
      backingCriterionChanged: false,
    }
    expect(classifyTestTamperingPrefilter(removedAssertion)).toBe('WEAKENING')
    const weak1 = await classifyTestTampering(removedAssertion, judgeInput, {
      judge,
    })
    expect(weak1.outcome).toBe('WEAKENING')
    expect(weak1.stage).toBe('PREFILTER')

    // --- weakening shape #2: a strong matcher loosened to a weak one
    const loosenedMatcher: PrefilterInput = {
      oldString: "it('adds', () => { expect(add(2, 2)).toBe(4) })",
      newString: "it('adds', () => { expect(add(2, 2)).toBeDefined() })",
      productionCodeCoChanged: false,
      backingCriterionChanged: false,
    }
    expect(classifyTestTamperingPrefilter(loosenedMatcher)).toBe('WEAKENING')
    expect(
      (await classifyTestTampering(loosenedMatcher, judgeInput, { judge }))
        .outcome
    ).toBe('WEAKENING')

    // --- weakening shape #3: a whole test case was deleted
    const deletedCase: PrefilterInput = {
      oldString:
        "it('a', () => { expect(f()).toBe(1) })\nit('b', () => { expect(g()).toBe(2) })",
      newString: "it('a', () => { expect(f()).toBe(1) })",
      productionCodeCoChanged: false,
      backingCriterionChanged: false,
    }
    expect(classifyTestTamperingPrefilter(deletedCase)).toBe('WEAKENING')
    expect(
      (await classifyTestTampering(deletedCase, judgeInput, { judge })).outcome
    ).toBe('WEAKENING')

    // The whole point of Stage 1: the LLM judge was never touched for any of the
    // clear cases above.
    expect(judge).not.toHaveBeenCalled()
  })

  it('assertionsWeakened detects removal, matcher-loosening and case deletion but not value-only changes', () => {
    // value-only change: strength preserved
    expect(
      assertionsWeakened(
        'expect(add(2, 2)).toBe(4)',
        'expect(add(2, 2)).toBe(5)'
      )
    ).toBe(false)
    // removed assertion
    expect(
      assertionsWeakened(
        "expect(a).toBe(1); expect(b).toBe('function')",
        "expect(b).toBe('function')"
      )
    ).toBe(true)
    // strong -> weak matcher
    expect(
      assertionsWeakened('expect(x).toBe(4)', 'expect(x).toBeDefined()')
    ).toBe(true)
    // deleted test case
    expect(
      assertionsWeakened(
        "it('a', () => { expect(f()).toBe(1) })\nit('b', () => { expect(g()).toBe(2) })",
        "it('a', () => { expect(f()).toBe(1) })"
      )
    ).toBe(true)
    // a Write (no before side) is unknown — never asserted as weakened
    expect(assertionsWeakened(null, 'expect(x).toBeDefined()')).toBe(false)
  })

  it('a downgrade requires positive legit evidence — uncomputable/absent signals never downgrade', () => {
    // not weakened, but no legit reason at all (test-only, no criterion edit) →
    // genuinely ambiguous, defer to Stage 2 (NOT a downgrade).
    expect(
      classifyTestTamperingPrefilter({
        oldString: 'expect(x).toBe(4)',
        newString: 'expect(x).toBe(5)',
        productionCodeCoChanged: false,
        backingCriterionChanged: false,
      })
    ).toBe('AMBIGUOUS')
    // signal A could not be computed (null) and no criterion edit → never LEGIT.
    expect(
      classifyTestTamperingPrefilter({
        oldString: 'expect(x).toBe(4)',
        newString: 'expect(x).toBe(5)',
        productionCodeCoChanged: null,
        backingCriterionChanged: false,
      })
    ).toBe('AMBIGUOUS')
    // weakened but a legit reason exists → ambiguous (could be a justified
    // tightening-down because behavior genuinely changed) → Stage 2 decides.
    expect(
      classifyTestTamperingPrefilter({
        oldString: 'expect(x).toBe(4)',
        newString: 'expect(x).toBeDefined()',
        productionCodeCoChanged: true,
        backingCriterionChanged: false,
      })
    ).toBe('AMBIGUOUS')
  })
})
