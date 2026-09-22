import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'
import { testCaseReminderService } from '@/lib/services/test-case-reminder.service'
import {
  computeNextSteps,
  type NextStep,
  type TaskStatusForNextSteps,
} from '@/lib/context/render/next-steps'

/**
 * State assembly for next-step suggestions (LUM-686).
 *
 * `computeNextSteps` is a pure rule table; this is the thin layer that fetches
 * the state it judges. Kept apart so the rules stay exhaustively unit-testable
 * without a database, and so every surface (task update, session attach, task
 * context) reaches the same verdict from the same reads.
 */
export const nextStepsService = {
  /**
   * Suggestions for a task that already exists. Three reads — the criteria
   * rows, an open-crossing flag, and the latest verdict per criterion.
   * N-5 (whole-branch review, second pass): the first of those used to be a
   * cheap `countByTask`; Finding 6 (first review) swapped it for
   * `listByTask` (full criterion rows, incl. `verifierType`) because
   * `isUnmetForDisplay` needs more than a count — so this now fans out with
   * criterion count, same as the other two reads already did. Still small in
   * practice (a contract rarely exceeds a few dozen rows) and still three
   * reads, just no longer three *O(1)* ones.
   */
  async forExistingTask(args: {
    taskId: string
    taskIdentifier: string
    status: TaskStatusForNextSteps
    sessionBound: boolean
    /**
     * True for surfaces whose response already carries
     * `renderCriteriaDraftNudge` (session attach, task context) — without it
     * the same advice would print twice on one screen.
     */
    criteriaNudgeAlreadyShown: boolean
    /**
     * LUM-807: true for the surfaces that already render the start-of-work
     * test-case section, so the delivery-time suggestion doesn't repeat it.
     */
    testCaseNudgeAlreadyShown?: boolean | undefined
  }): Promise<NextStep[]> {
    const [criteria, hasOpenCrossing, latestRuns, testCase] = await Promise.all(
      [
        acceptanceCriterionRepository.listByTask(args.taskId),
        boundaryCrossingRepository.hasOpenForTask(args.taskId),
        verificationRunRepository.latestRunsByCriterion(args.taskId),
        // LUM-807: two existence checks; the rule table decides what they
        // mean. Degrades to `undefined` on a read failure — the rule then
        // stays silent, exactly as it does against an older server. An
        // advisory suggestion must never take a task command down with it.
        testCaseReminderService
          .stateForTask({
            taskId: args.taskId,
            taskDone: args.status === 'DONE',
          })
          .catch(() => undefined),
      ]
    )

    const runs = [...latestRuns.values()]
    // Rounds are 0-indexed on the run rows; the round the task is *on* is one
    // past the highest round already judged.
    const verifyRound =
      runs.length === 0 ? 0 : Math.max(...runs.map(r => r.round)) + 1
    // Finding 6 (whole-branch review): this used to be a run-count heuristic
    // (`runs.some(FAIL) || runs.length < criteriaCount`) that counted ANY
    // run-less criterion as unmet — HUMAN included. A tacit-pass HUMAN
    // criterion (never adjudicated, never sent back) would then make a
    // reopened IN_REVIEW task's injected next-step claim "left criteria
    // unmet — read them before re-verifying" while `lumo task status` in the
    // same breath reports 0 unmet: a token-priced dead end with no unmet
    // criterion to actually go read. Derive it from the same
    // isUnmetForDisplay the server's nextActions and `lumo task status`
    // already use, so every surface agrees.
    const hasUnmetCriteria = criteria.some(c => {
      const run = latestRuns.get(c.id)
      return isUnmetForDisplay(c, run ? { verdict: run.verdict } : undefined)
    })

    return computeNextSteps({
      taskIdentifier: args.taskIdentifier,
      status: args.status,
      hasCriteria: criteria.length > 0,
      sessionBound: args.sessionBound,
      openCrossings: hasOpenCrossing ? 1 : 0,
      verifyRound,
      hasUnmetCriteria,
      criteriaNudgeAlreadyShown: args.criteriaNudgeAlreadyShown,
      testCase,
      testCaseNudgeAlreadyShown: args.testCaseNudgeAlreadyShown ?? false,
    })
  },
}
