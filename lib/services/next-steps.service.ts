import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
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
   * Suggestions for a task that already exists. Two reads — an open-crossing
   * flag and the test-case reminder state.
   */
  async forExistingTask(args: {
    taskId: string
    taskIdentifier: string
    status: TaskStatusForNextSteps
    sessionBound: boolean
    /**
     * LUM-807: true for the surfaces that already render the start-of-work
     * test-case section, so the delivery-time suggestion doesn't repeat it.
     */
    testCaseNudgeAlreadyShown?: boolean | undefined
  }): Promise<NextStep[]> {
    const [hasOpenCrossing, testCase] = await Promise.all([
      boundaryCrossingRepository.hasOpenForTask(args.taskId),
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
    ])

    return computeNextSteps({
      taskIdentifier: args.taskIdentifier,
      status: args.status,
      sessionBound: args.sessionBound,
      openCrossings: hasOpenCrossing ? 1 : 0,
      testCase,
      testCaseNudgeAlreadyShown: args.testCaseNudgeAlreadyShown ?? false,
    })
  },
}
