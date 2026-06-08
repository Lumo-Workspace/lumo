import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

/**
 * Whether each of the three "rare" timeline tabs (Agent Run / Memory / Lineage)
 * has any content for a task. Computed server-side at page render so the tab
 * bar can decide visibility on first paint instead of waiting for the client
 * presence probes to round-trip (LUM-321) — eliminating the tab pop-in.
 */
export interface TaskTimelinePresence {
  hasAgentRuns: boolean
  hasMemories: boolean
  hasLineage: boolean
}

export const taskTimelinePresenceService = {
  /**
   * Cheap existence checks that mirror each tab panel's empty-state predicate,
   * so the SSR tab bar can never drift from what the client probe will resolve:
   *  - Memory tab: any Memory row for the task (memoryRepository.listForTask).
   *  - Lineage tab: any LineageEdge for the task (every edge forms a group).
   *  - Agent Run tab: agentRunTimelineService keeps a run only when
   *    toolCallCount>0 OR memoryCount>0, so presence is tool-use OR memory.
   * Run in parallel — they're independent indexed lookups.
   */
  async getPresence(taskId: string): Promise<TaskTimelinePresence> {
    const [hasToolUse, hasMemories, hasLineage] = await Promise.all([
      hookEventRepository.hasToolUseForTask(taskId),
      memoryRepository.hasForTask(taskId),
      lineageEdgeRepository.hasForTask(taskId),
    ])

    return {
      hasAgentRuns: hasToolUse || hasMemories,
      hasMemories,
      hasLineage,
    }
  },
}
