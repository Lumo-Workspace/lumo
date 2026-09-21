import {
  computeNextSteps,
  NEXT_STEPS_MAX,
  type NextStepsInput,
} from '@/lib/context/render/next-steps'
import { renderCriteriaDraftNudge } from '@/lib/context/render/criteria'

/**
 * Baseline input: a freshly created task, nothing done yet. Each test overrides
 * only the dimension it exercises so the rule under test is unambiguous.
 */
function input(overrides: Partial<NextStepsInput> = {}): NextStepsInput {
  return {
    taskIdentifier: 'LUM-686',
    status: 'TODO',
    hasCriteria: false,
    sessionBound: false,
    openCrossings: 0,
    verifyRound: 0,
    hasUnmetCriteria: false,
    criteriaNudgeAlreadyShown: false,
    ...overrides,
  }
}

/** Join the commands of a step list for concise assertions. */
function commands(steps: ReturnType<typeof computeNextSteps>): string[] {
  return steps.map(s => s.command).filter((c): c is string => c !== null)
}

describe('computeNextSteps', () => {
  it('computeNextSteps returns rule-table steps capped at three', () => {
    // Unbound + no contract: attach first, then draft the contract.
    const fresh = computeNextSteps(input())
    expect(commands(fresh)).toEqual([
      'lumo session attach LUM-686',
      'lumo task criteria set LUM-686 --file <criteria.json>',
    ])

    // Contract in place and work underway: verify is the next move.
    const working = computeNextSteps(
      input({ status: 'IN_PROGRESS', hasCriteria: true, sessionBound: true })
    )
    expect(commands(working)).toContain('lumo verify --note "<self-report>"')

    // A status-only rule needs no command — IN_REVIEW means stop and wait.
    const inReview = computeNextSteps(
      input({ status: 'IN_REVIEW', hasCriteria: true, sessionBound: true })
    )
    expect(inReview[0]?.command).toBeNull()
    expect(inReview[0]?.why).toMatch(/human/i)

    // An open boundary crossing outranks routine suggestions.
    const crossing = computeNextSteps(
      input({ status: 'IN_PROGRESS', hasCriteria: true, openCrossings: 2 })
    )
    expect(commands(crossing)[0]).toBe(
      'lumo crossing explain LUM-686 --note "<text>"'
    )

    // A rejected round points at the unmet-criteria read-out.
    const bounced = computeNextSteps(
      input({
        status: 'IN_PROGRESS',
        hasCriteria: true,
        sessionBound: true,
        verifyRound: 1,
        hasUnmetCriteria: true,
      })
    )
    expect(commands(bounced)).toContain('lumo task status LUM-686')

    // The cap holds even when every rule fires at once. Hints are resident
    // token cost — an uncapped list would be the noise this feature must avoid.
    const everything = computeNextSteps(
      input({
        status: 'IN_PROGRESS',
        hasCriteria: false,
        sessionBound: false,
        openCrossings: 3,
        verifyRound: 2,
        hasUnmetCriteria: true,
      })
    )
    expect(everything.length).toBeLessThanOrEqual(NEXT_STEPS_MAX)
    expect(NEXT_STEPS_MAX).toBe(3)
  })

  it('criteria draft nudge is never duplicated by nextSteps', () => {
    // `session attach` / `task context` already carry renderCriteriaDraftNudge
    // in their criteriaSection. Emitting a criteria suggestion here too would
    // print the same advice twice on one screen.
    const alreadyShown = computeNextSteps(
      input({ hasCriteria: false, criteriaNudgeAlreadyShown: true })
    )
    expect(commands(alreadyShown).some(c => c.includes('criteria set'))).toBe(
      false
    )

    // Guard the real rendered text, not just our own phrasing: no step may
    // restate what the nudge section already says.
    const nudge = renderCriteriaDraftNudge()
    for (const step of alreadyShown) {
      expect(nudge).not.toContain(step.command ?? '\u0000never\u0000')
    }

    // Surfaces without the nudge (task create, task update) must still say it.
    const notShown = computeNextSteps(
      input({ hasCriteria: false, criteriaNudgeAlreadyShown: false })
    )
    expect(commands(notShown).some(c => c.includes('criteria set'))).toBe(true)

    // With a contract present the suggestion is gone either way.
    const hasContract = computeNextSteps(
      input({ hasCriteria: true, sessionBound: true })
    )
    expect(commands(hasContract).some(c => c.includes('criteria set'))).toBe(
      false
    )
  })
  it('next step suggests testcase add only with a linked PR and zero test cases', () => {
    const delivering: Partial<NextStepsInput> = {
      status: 'IN_PROGRESS',
      hasCriteria: true,
      sessionBound: true,
      testCase: { hasTestCases: false, hasLinkedPr: true, taskDone: false },
    }

    // PR open, no script recorded → the suggestion appears…
    const open = computeNextSteps(input(delivering))
    expect(
      commands(open).some(c => c.startsWith('lumo task testcase add LUM-686'))
    ).toBe(true)
    // …and yields to the rules that actually gate delivery: it is last.
    const openCommands = commands(open)
    expect(openCommands[openCommands.length - 1]).toContain('task testcase add')
    expect(commands(open)).toContain('lumo verify --note "<self-report>"')

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

    // Blockers still win the cap: crossing + contract + verify leave no slot.
    const crowded = computeNextSteps(
      input({
        ...delivering,
        hasCriteria: false,
        openCrossings: 1,
        sessionBound: false,
      })
    )
    expect(crowded).toHaveLength(NEXT_STEPS_MAX)
    expect(commands(crowded).some(c => c.includes('testcase add'))).toBe(false)
  })
})
