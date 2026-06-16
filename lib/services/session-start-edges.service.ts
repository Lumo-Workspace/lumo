import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import { logger } from '@/lib/logger'

/**
 * The single source of truth for "what fragments a bound session-start
 * produces". Both the session-start hook and the `lumo session attach` server
 * path build their lineage-edge fragment list through this, so the two
 * collection trigger-points can never drift (LUM-528).
 */
export function aggregateSessionStartFragments(input: {
  sectionFragments: FragmentRef[]
  todoFragments: FragmentRef[]
  layer2Fragments: FragmentRef[]
  previousSessionId: string | null
}): FragmentRef[] {
  return [
    ...input.sectionFragments,
    ...input.todoFragments,
    ...input.layer2Fragments,
    ...(input.previousSessionId
      ? [
          {
            fragmentType: 'SESSION' as const,
            fragmentId: input.previousSessionId,
          },
        ]
      : []),
  ]
}

export const sessionStartEdgesService = {
  /**
   * Build the full session-start fragment bundle for a bound task+session and
   * record the lineage edges + relevance-gate drops — the same collection the
   * session-start hook does, but driven from `lumo session attach` (LUM-528).
   * The first session-start (startup) is structurally unbound, so the common
   * open→attach→work→end session never had a second session-start to collect
   * it; this closes that gap. Idempotent across a later bound session-start via
   * the edge unique index + skipDuplicates. Best-effort: never throws — it runs
   * inside the attach route's `waitUntil` and must not affect the bind result.
   */
  async collectAndRecord(input: {
    workspaceId: string
    taskId: string
    sessionId: string
  }): Promise<void> {
    const { workspaceId, taskId, sessionId } = input
    try {
      const [sections, todos, layer2Review, previous] = await Promise.all([
        taskContextService.buildSessionStartSections(taskId),
        taskContextService.buildReviewTodosSectionForTask(taskId),
        taskContextService.buildLayer2ReviewSectionForTask(taskId, sessionId),
        taskContextService.buildPreviousSessionRecoveryForTask(
          taskId,
          sessionId
        ),
      ])

      const fragments = aggregateSessionStartFragments({
        sectionFragments: sections.fragments,
        todoFragments: todos.fragments,
        layer2Fragments: layer2Review.fragments,
        previousSessionId: previous?.sessionId ?? null,
      })

      await Promise.all([
        fragments.length > 0
          ? lineageService.recordSessionStartEdges({
              workspaceId,
              taskId,
              sessionId,
              fragments,
            })
          : Promise.resolve(),
        sections.droppedFragments.length > 0
          ? lineageService.recordDroppedFragments({
              workspaceId,
              taskId,
              sessionId,
              dropped: sections.droppedFragments,
            })
          : Promise.resolve(),
      ])
    } catch (err) {
      // Best-effort: the record methods already self-catch; this guards the
      // builder calls so attach is never broken by collection (LUM-528).
      logger.error('sessionStartEdgesService.collectAndRecord failed', err)
    }
  },
}
