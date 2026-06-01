import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      let memorySection = ''
      let reviewTodosSection = ''
      if (binding.bound === true) {
        ;[memorySection, reviewTodosSection] = await Promise.all([
          taskContextService.buildMemorySectionForTask(binding.taskId),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
        ])
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
        reviewTodosSection,
      }
    },
  })
}
