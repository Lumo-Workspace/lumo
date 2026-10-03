import {
  computeNextSteps,
  NEXT_STEPS_MAX,
  type NextStepsInput,
} from '@/lib/context/render/next-steps'

/**
 * Baseline input: a freshly created task, nothing done yet. Each test overrides
 * only the dimension it exercises so the rule under test is unambiguous.
 */
function input(overrides: Partial<NextStepsInput> = {}): NextStepsInput {
  return {
    taskIdentifier: 'LUM-686',
    status: 'TODO',
    sessionBound: false,
    openCrossings: 0,
    ...overrides,
  }
}

/** Join the commands of a step list for concise assertions. */
function commands(steps: ReturnType<typeof computeNextSteps>): string[] {
  return steps.map(s => s.command).filter((c): c is string => c !== null)
}

describe('computeNextSteps', () => {
  it('computeNextSteps returns rule-table steps capped at three', () => {
    // Unbound: attach first.
    const fresh = computeNextSteps(input())
    expect(commands(fresh)).toEqual(['lumo session attach LUM-686'])

    // Bound and working with nothing outstanding: nothing to suggest.
    const working = computeNextSteps(
      input({ status: 'IN_PROGRESS', sessionBound: true })
    )
    expect(working).toEqual([])

    // A status-only rule needs no command — IN_REVIEW means stop and wait.
    const inReview = computeNextSteps(
      input({ status: 'IN_REVIEW', sessionBound: true })
    )
    expect(inReview[0]?.command).toBeNull()
    expect(inReview[0]?.why).toMatch(/human/i)

    // An open boundary crossing outranks routine suggestions.
    const crossing = computeNextSteps(
      input({ status: 'IN_PROGRESS', openCrossings: 2 })
    )
    expect(commands(crossing)[0]).toBe(
      'lumo crossing explain <id> --task LUM-686 --note "<text>"'
    )

    // A delivered task has nothing to suggest.
    expect(
      computeNextSteps(input({ status: 'DONE', openCrossings: 1 }))
    ).toEqual([])
  })

  it('never suggests the removed acceptance-criteria commands (LUM-942)', () => {
    for (const status of ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] as const) {
      const all = commands(computeNextSteps(input({ status })))
      expect(all.some(c => c.includes('criteria'))).toBe(false)
      expect(all.some(c => c.startsWith('lumo verify'))).toBe(false)
    }
  })

  it('next step suggests testcase add only with a linked PR and zero test cases', () => {
    const delivering: Partial<NextStepsInput> = {
      status: 'IN_PROGRESS',
      sessionBound: true,
      testCase: { hasTestCases: false, hasLinkedPr: true, taskDone: false },
    }

    // PR open, no script recorded → the suggestion appears, last.
    const open = commands(computeNextSteps(input(delivering)))
    expect(open.some(c => c.startsWith('lumo task testcase add LUM-686'))).toBe(
      true
    )
    expect(open[open.length - 1]).toContain('task testcase add')

    // No PR yet: the delivery gate keeps the Next: block quiet (the
    // start-of-work section owns that moment instead).
    const early = computeNextSteps(
      input({
        ...delivering,
        testCase: { hasTestCases: false, hasLinkedPr: false, taskDone: false },
      })
    )
    expect(commands(early).some(c => c.includes('testcase add'))).toBe(false)

    // A script already exists → nothing to ask for.
    const recorded = computeNextSteps(
      input({
        ...delivering,
        testCase: { hasTestCases: true, hasLinkedPr: true, taskDone: false },
      })
    )
    expect(commands(recorded).some(c => c.includes('testcase add'))).toBe(false)

    // The surfaces that already render the start-of-work section do not
    // repeat it as a step.
    const alreadyShown = computeNextSteps(
      input({ ...delivering, testCaseNudgeAlreadyShown: true })
    )
    expect(commands(alreadyShown).some(c => c.includes('testcase add'))).toBe(
      false
    )

    // An older server sends no test-case state at all — the rule stays silent
    // rather than guessing.
    const legacy = computeNextSteps(
      input({ ...delivering, testCase: undefined })
    )
    expect(commands(legacy).some(c => c.includes('testcase add'))).toBe(false)

    // Never more than the cap.
    const crowded = computeNextSteps(
      input({ ...delivering, openCrossings: 1, sessionBound: false })
    )
    expect(crowded.length).toBeLessThanOrEqual(NEXT_STEPS_MAX)
  })
})
