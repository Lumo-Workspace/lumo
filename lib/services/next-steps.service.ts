import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'
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
   * Suggestions for a task that already exists. Three cheap reads — criterion
   * count, open-crossing flag, latest verdict per criterion — none of which
   * fan out with task size.
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
  }): Promise<NextStep[]> {
    const [criteria, hasOpenCrossing, latestRuns] = await Promise.all([
      acceptanceCriterionRepository.listByTask(args.taskId),
      boundaryCrossingRepository.hasOpenForTask(args.taskId),
      verificationRunRepository.latestRunsByCriterion(args.taskId),
    ])

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
    })
  },
}
