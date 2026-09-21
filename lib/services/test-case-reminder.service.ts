import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import type { TestCaseReminderState } from '@/lib/context/render/test-case-reminder'

/**
 * State assembly for test-case reminders (LUM-807).
 *
 * The rule half is a pure table in `lib/context/render/test-case-reminder.ts`;
 * this is the thin read layer beneath it, mirroring the
 * `next-steps.service.ts` / `pr-security-reminder.service.ts` split. Read-only
 * and LLM-free, so the session-start route, task-context, verify and
 * `task status` can all import it statically and reach the same verdict from
 * the same two reads.
 *
 * Both reads are existence checks, not listings: a reminder only ever needs to
 * know *whether* a script and a PR exist, and this runs on every attach.
 */
export const testCaseReminderService = {
  async stateForTask(args: {
    taskId: string
    taskDone: boolean
  }): Promise<TestCaseReminderState> {
    const [hasTestCases, prs] = await Promise.all([
      testCaseRepository.hasForTask(args.taskId),
      pullRequestRepository.listIdAndNumberByTask(args.taskId),
    ])
    return {
      hasTestCases,
      hasLinkedPr: prs.length > 0,
      taskDone: args.taskDone,
    }
  },
}
