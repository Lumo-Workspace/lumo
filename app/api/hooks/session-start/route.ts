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
      let layer2ReviewSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        const [sections, todos, previous, layer2Review] = await Promise.all([
          taskContextService.buildSessionStartSections(binding.taskId),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
          taskContextService.buildPreviousSessionRecoveryForTask(
            binding.taskId,
            ctx.sessionId
          ),
          taskContextService.buildLayer2ReviewSectionForTask(
            binding.taskId,
            ctx.sessionId
          ),
        ])
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        reviewTodosSection = todos.section
        previousSession = previous
        layer2ReviewSection = layer2Review.section
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
        linkedResourcesSection,
        reviewTodosSection,
        layer2ReviewSection,
        previousSession,
      }
    },
  })
}
