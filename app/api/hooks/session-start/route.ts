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
      let linkedResourcesSection = ''
      let reviewTodosSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        const [sections, todos, previous] = await Promise.all([
          taskContextService.buildSessionStartSections(binding.taskId),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
          taskContextService.buildPreviousSessionRecoveryForTask(
            binding.taskId,
            ctx.sessionId
          ),
        ])
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        reviewTodosSection = todos
        previousSession = previous
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
        linkedResourcesSection,
        reviewTodosSection,
        previousSession,
      }
    },
  })
}
