import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import {
  buildSessionStartContextMetrics,
  CONTEXT_METRICS_KEY,
} from '@/lib/context/injection-metrics'
import type { Prisma } from '@prisma/client'
import { waitUntil } from '@vercel/functions'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const sessionId = ctx.sessionId
      const binding = await sessionRepository.findTaskBinding(sessionId)
      let criteriaSection = ''
      let progressSection = ''
      let memorySection = ''
      let linkedResourcesSection = ''
      let reviewTodosSection = ''
      let layer2ReviewSection = ''
      let blockerWarningSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        const [
          sections,
          todos,
          previous,
          progress,
          layer2Review,
          blockerWarning,
        ] = await Promise.all([
          taskContextService.buildSessionStartSections(binding.taskId),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
          // Structured recovery: still drives the lineage SESSION fragment and
          // the LUM-402 metrics stamp. The CLI no longer renders it as a card —
          // the server-rendered Tier-1 progressSection below replaces it.
          taskContextService.buildPreviousSessionRecoveryForTask(
            binding.taskId,
            sessionId
          ),
          // LUM-500 Tier-1: the prior-session progress summary, rendered
          // server-side so it injects in full alongside the criteria contract.
          taskContextService.buildProgressSectionForTask(
            binding.taskId,
            sessionId
          ),
          taskContextService.buildLayer2ReviewSectionForTask(
            binding.taskId,
            sessionId
          ),
          // Never throws — returns '' on failure, so the warning can't
          // break session-start context injection (LUM-172).
          taskDependencyService.buildBlockerWarningSectionForTask(
            binding.taskId,
            binding.taskIdentifier
          ),
        ])
        criteriaSection = sections.criteriaSection
        progressSection = progress
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        reviewTodosSection = todos.section
        previousSession = previous
        layer2ReviewSection = layer2Review.section
        blockerWarningSection = blockerWarning

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

        // LUM-402: stamp per-section injection metrics onto the stored
        // SESSION_START row so budget pressure is SQL-queryable after the
        // fact. Observe-only (the metrics never enter the injected context)
        // and fire-and-forget — must not block or fail the injection.
        const contextMetrics = buildSessionStartContextMetrics({
          budgetTokens: sections.budget.budgetTokens,
          allocation: {
            ...sections.budget.sections,
            layer2Review: {
              keptCards: layer2Review.fragments.length,
              droppedCards: layer2Review.dropped,
            },
          },
          criteriaSection,
          memorySection,
          linkedResourcesSection,
          reviewTodosSection,
          previousSession,
          layer2ReviewSection,
          blockerWarningSection,
        })
        const payloadWithMetrics = {
          ...(ctx.payload as Record<string, unknown>),
          [CONTEXT_METRICS_KEY]: contextMetrics,
        } as unknown as Prisma.InputJsonValue
        waitUntil(
          hookEventRepository
            .setContextInjectionMetrics(ctx.eventId, payloadWithMetrics)
            // Self-catch: the promise is never awaited, so a rejection here
            // would surface as an unhandled rejection instead of being eaten
            // by the handler's afterRecord guard (same as lineage edges).
            .catch(error =>
              console.error('session-start context metrics stamp error:', error)
            )
        )
      }
      return {
        sessionId,
        taskBinding: binding,
        criteriaSection,
        progressSection,
        memorySection,
        linkedResourcesSection,
        reviewTodosSection,
        layer2ReviewSection,
        blockerWarningSection,
        previousSession,
      }
    },
  })
}
