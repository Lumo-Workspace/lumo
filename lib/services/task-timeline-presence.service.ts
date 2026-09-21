import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

/**
 * Whether each of the "rare" timeline tabs (Memory / Lineage / Acceptance) has
 * any content for a task. Computed server-side at page render so the tab bar
 * can decide visibility on first paint instead of waiting for the client
 * presence probes to round-trip (LUM-321) — eliminating tab pop-in. (The
 * Delivery tab is unconditionally visible since LUM-471, so it needs no probe.)
 *
 * `hasOpenCrossings` (LUM-520) is not a tab-visibility signal — the delivery tab
 * is always shown — but a sub-tab default: an open boundary crossing makes the
 * delivery tab land on its Acceptance sub-segment so the crossing is seen even
 * when the task has no acceptance criteria.
 */
export interface TaskTimelinePresence {
  hasMemories: boolean
  hasLineage: boolean
  hasCriteria: boolean
  hasOpenCrossings: boolean
  /** LUM-801: Tests tab 是否有内容。tab 本身恒显示，这个只用来避免首帧闪。 */
  hasTestCases: boolean
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
    const [
      hasMemories,
      hasLineage,
      criterionCount,
      hasOpenCrossings,
      hasTestCases,
    ] = await Promise.all([
      memoryRepository.hasForTask(taskId),
      lineageEdgeRepository.hasForTask(taskId),
      // Acceptance tab: any criterion (the contract) → tab is shown.
      acceptanceCriterionRepository.countByTask(taskId),
      // Delivery sub-tab default: any OPEN crossing → land on Acceptance.
      boundaryCrossingRepository.hasOpenForTask(taskId),
      // LUM-801: Tests tab content presence.
      testCaseRepository.hasForTask(taskId),
    ])

    return {
      hasMemories,
      hasLineage,
      hasCriteria: criterionCount > 0,
      hasOpenCrossings,
      hasTestCases,
    }
  },
}
