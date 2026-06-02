import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      let memorySection = ''
      let reviewTodosSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        ;[memorySection, reviewTodosSection, previousSession] =
          await Promise.all([
            taskContextService.buildMemorySectionForTask(binding.taskId),
            taskContextService.buildReviewTodosSectionForTask(binding.taskId),
            taskContextService.buildPreviousSessionRecoveryForTask(
              binding.taskId,
              ctx.sessionId
            ),
          ])
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
        reviewTodosSection,
        previousSession,
      }
    },
  })
}
