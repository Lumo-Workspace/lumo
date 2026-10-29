import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import { aggregateSessionStartFragments } from '@/lib/services/session-start-edges.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { workspaceDeletionService } from '@/lib/services/workspace-deletion.service'
import { sessionRecordNoticeService } from '@/lib/services/session-record-notice.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import {
  buildSessionStartContextMetrics,
  CONTEXT_METRICS_KEY,
} from '@/lib/context/injection-metrics'
import type { Prisma } from '@prisma/client'
import { waitUntil } from '@/lib/runtime/wait-until'
import { cliCommandNamesFromHeaders } from '@/lib/cli/command-names'

export async function POST(request: Request) {
  // LUM-1233: the hook runs in the caller's CLI, so its version picks the
  // command names the injected sections may point at.
  const commands = cliCommandNamesFromHeaders(request.headers)
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const sessionId = ctx.sessionId
      const [binding, workspaceNoticeSection, sessionRecords] =
        await Promise.all([
          sessionRepository.findTaskBinding(sessionId),
          // LUM-923: bound or not, the agent learns of a pending deletion.
          workspaceDeletionService.buildPendingNoticeSection(ctx.workspaceId),
          // LUM-943: bound or not, how this workspace keeps session records.
          // Read fresh every session start; null (never throws) skips the line.
          sessionRecordNoticeService.getForWorkspace(ctx.workspaceId),
        ])
      const sessionRecordNotice = sessionRecords?.notice ?? ''
      // LUM-807: "## Test cases" nudge.
      let testCaseSection = ''
      let progressSection = ''
      let memorySection = ''
      let linkedResourcesSection = ''
      let securityFindingsSection = ''
      let reviewTodosSection = ''
      let layer2ReviewSection = ''
      let blockerWarningSection = ''
      let stewardMemorySection = ''
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
          taskContextService.buildSessionStartSections(
            binding.taskId,
            commands
          ),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
          // Structured recovery: still drives the lineage SESSION fragment and
          // the LUM-402 metrics stamp. The CLI no longer renders it as a card —
          // the server-rendered Tier-1 progressSection below replaces it.
          taskContextService.buildPreviousSessionRecoveryForTask(
            binding.taskId,
            sessionId
          ),
          // LUM-500 Tier-1: the prior-session progress summary, rendered
          // server-side so it injects in full.
          taskContextService.buildProgressSectionForTask(
            binding.taskId,
            sessionId,
            commands
          ),
          taskContextService.buildLayer2ReviewSectionForTask(
            binding.taskId,
            sessionId,
            commands
          ),
          // Never throws — returns '' on failure, so the warning can't
          // break session-start context injection (LUM-172).
          taskDependencyService.buildBlockerWarningSectionForTask(
            binding.taskId,
            binding.taskIdentifier,
            commands
          ),
        ])
        testCaseSection = sections.testCaseSection
        progressSection = progress
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        securityFindingsSection = sections.securityFindingsSection
        reviewTodosSection = todos.section
        previousSession = previous
        layer2ReviewSection = layer2Review.section
        blockerWarningSection = blockerWarning

        // LUM-276: record one lineage edge per fragment this session consumed.
        // Fire-and-forget — must not block or fail the context injection.
        const fragments = aggregateSessionStartFragments({
          sectionFragments: sections.fragments,
          todoFragments: todos.fragments,
          layer2Fragments: layer2Review.fragments,
          previousSessionId: previous?.sessionId ?? null,
        })
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

        // LUM-522: persist relevance-gate-dropped fragments (fire-and-forget).
        if (sections.droppedFragments.length > 0) {
          waitUntil(
            lineageService.recordDroppedFragments({
              workspaceId: ctx.workspaceId,
              taskId: binding.taskId,
              sessionId,
              dropped: sections.droppedFragments,
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
          memorySection,
          linkedResourcesSection,
          reviewTodosSection,
          progressSection,
          layer2ReviewSection,
          blockerWarningSection,
        })
        const payloadWithMetrics = {
          ...(ctx.payload as Record<string, unknown>),
          [CONTEXT_METRICS_KEY]: contextMetrics,
        } as unknown as Prisma.InputJsonValue
        waitUntil(
          hookEventRepository
            .setContextInjectionMetrics(
              ctx.workspaceId,
              ctx.eventId,
              payloadWithMetrics
            )
            // Self-catch: the promise is never awaited, so a rejection here
            // would surface as an unhandled rejection instead of being eaten
            // by the handler's afterRecord guard (same as lineage edges).
            .catch(error =>
              console.error('session-start context metrics stamp error:', error)
            )
        )
      } else {
        // LUM-647: a resumed milestone STEWARD session re-injects this project's
        // prior-milestone learnings (the distilled cross-milestone learning
        // unit). First-attach injection rides the bind-milestone response; this
        // branch covers session resume. Best-effort throughout — a lookup or
        // render failure must never break session-start context injection.
        try {
          const steward = await sessionRepository.findStewardBinding(sessionId)
          if (steward) {
            const { stewardContextService } =
              await import('@/lib/services/steward-context.service')
            const built = await stewardContextService.buildStewardSections(
              steward.milestoneId,
              commands
            )
            stewardMemorySection = built.section

            // LUM-648: birth one cross-milestone learning edge per injected
            // prior-milestone memory (resume path — first-attach edges ride the
            // bind-milestone response). Fire-and-forget; idempotent via the
            // [sessionId, memoryId] unique index, so re-injection on every
            // resume never double-counts.
            if (built.memories.length > 0) {
              const { milestoneMemoryEdgeRepository } =
                await import('@/lib/repositories/milestone-memory-edge.repository')
              waitUntil(
                milestoneMemoryEdgeRepository
                  .recordInjection({
                    workspaceId: ctx.workspaceId,
                    consumerMilestoneId: steward.milestoneId,
                    sessionId,
                    rows: built.memories,
                  })
                  .catch(error =>
                    console.error(
                      'session-start steward memory edge birth error:',
                      error
                    )
                  )
              )
            }
          }
        } catch (error) {
          console.error('session-start steward memory injection error:', error)
        }
      }
      return {
        sessionId,
        taskBinding: binding,
        workspaceNoticeSection,
        sessionRecordNotice,
        testCaseSection,
        progressSection,
        memorySection,
        linkedResourcesSection,
        securityFindingsSection,
        reviewTodosSection,
        layer2ReviewSection,
        blockerWarningSection,
        stewardMemorySection,
        previousSession,
      }
    },
  })
}
