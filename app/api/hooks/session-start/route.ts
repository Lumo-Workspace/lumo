import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { waitUntil } from '@vercel/functions'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const sessionId = ctx.sessionId
      const binding = await sessionRepository.findTaskBinding(sessionId)
      let criteriaSection = ''
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
            sessionId
          ),
          taskContextService.buildLayer2ReviewSectionForTask(
            binding.taskId,
            sessionId
          ),
        ])
        criteriaSection = sections.criteriaSection
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        reviewTodosSection = todos.section
        previousSession = previous
        layer2ReviewSection = layer2Review.section

        // LUM-276: record one lineage edge per fragment this session consumed.
        // Fire-and-forget — must not block or fail the context injection.
        const fragments: FragmentRef[] = [
          ...sections.fragments,
          ...todos.fragments,
          ...layer2Review.fragments,
          ...(previous
            ? [
                {
                  fragmentType: 'SESSION' as const,
                  fragmentId: previous.sessionId,
                },
              ]
            : []),
        ]
        if (fragments.length > 0) {
          waitUntil(
            lineageService.recordSessionStartEdges({
              workspaceId: ctx.workspaceId,
              taskId: binding.taskId,
              sessionId,
              fragments,
            })
          )
        }
      }
      return {
        sessionId,
        taskBinding: binding,
        criteriaSection,
        memorySection,
        linkedResourcesSection,
        reviewTodosSection,
        layer2ReviewSection,
        previousSession,
      }
    },
  })
}
