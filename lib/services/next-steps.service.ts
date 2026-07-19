import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
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
    const [criteriaCount, hasOpenCrossing, latestRuns] = await Promise.all([
      acceptanceCriterionRepository.countByTask(args.taskId),
      boundaryCrossingRepository.hasOpenForTask(args.taskId),
      verificationRunRepository.latestRunsByCriterion(args.taskId),
    ])

    const runs = [...latestRuns.values()]
    // Rounds are 0-indexed on the run rows; the round the task is *on* is one
    // past the highest round already judged.
    const verifyRound =
      runs.length === 0 ? 0 : Math.max(...runs.map(r => r.round)) + 1
    const hasUnmetCriteria =
      runs.some(r => r.verdict === 'FAIL') || runs.length < criteriaCount

    return computeNextSteps({
      taskIdentifier: args.taskIdentifier,
      status: args.status,
      hasCriteria: criteriaCount > 0,
      sessionBound: args.sessionBound,
      openCrossings: hasOpenCrossing ? 1 : 0,
      verifyRound,
      hasUnmetCriteria,
      criteriaNudgeAlreadyShown: args.criteriaNudgeAlreadyShown,
    })
  },
}
