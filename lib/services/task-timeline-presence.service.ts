import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

/**
 * Whether each of the "rare" timeline tabs (Memory / Lineage / Acceptance) has
 * any content for a task. Computed server-side at page render so the tab bar
 * can decide visibility on first paint instead of waiting for the client
 * presence probes to round-trip (LUM-321) — eliminating tab pop-in. (The
 * Delivery tab is unconditionally visible since LUM-471, so it needs no probe.)
 */
export interface TaskTimelinePresence {
  hasMemories: boolean
  hasLineage: boolean
  hasCriteria: boolean
}

export const taskTimelinePresenceService = {
  /**
   * Cheap existence checks that mirror each tab panel's empty-state predicate,
   * so the SSR tab bar can never drift from what the client probe will resolve:
   *  - Memory tab: any Memory row for the task (memoryRepository.listForTask).
   *  - Lineage tab: any LineageEdge for the task (every edge forms a group).
   * Run in parallel — they're independent indexed lookups.
   */
  async getPresence(taskId: string): Promise<TaskTimelinePresence> {
    const [hasMemories, hasLineage, criterionCount] = await Promise.all([
      memoryRepository.hasForTask(taskId),
      lineageEdgeRepository.hasForTask(taskId),
      // Acceptance tab: any criterion (the contract) → tab is shown.
      acceptanceCriterionRepository.countByTask(taskId),
    ])

    return {
      hasMemories,
      hasLineage,
      hasCriteria: criterionCount > 0,
    }
  },
}
