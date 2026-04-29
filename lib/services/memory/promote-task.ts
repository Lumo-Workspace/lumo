import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { layer2Service } from './layer2.service'
import { getLayer3Input } from './layer3-input'
import { extractLayer3Operations } from './layer3-extract'
import { buildLayer3Plans, type Layer3ApplyResult } from './layer3-apply'

export interface PromoteTaskResult {
  /** "skipped" — task / its memories not found; nothing to do. */
  /** "no-promote" — Layer 2 ran, returned 0 facts; task memory archived. */
  /** "applied" — Layer 3 produced operations; project memory updated and task memory archived. */
  outcome: 'skipped' | 'no-promote' | 'applied'
  layer3?: Layer3ApplyResult
  /** How many task-scoped memories were archived in this promotion. */
  archived?: number
}

/**
 * Run the full task-done memory promotion: Layer 2 distills task memory →
 * Layer 3 merges into project memory → task memory is archived. The
 * project-memory writes and the task-memory archive happen in a single
 * transaction so a failure in the apply step leaves task memory intact for a
 * future retry (no half-promoted state).
 *
 * Owns its own error handling — never throws. Caller (status-update side
 * effect) runs under `waitUntil()` and does not see exceptions thrown after
 * the response has been returned.
 */
export const promoteTaskService = {
  async promoteTaskMemory(taskId: string): Promise<PromoteTaskResult> {
    try {
      const layer2 = await layer2Service.consolidateTaskMemory(taskId)

      // No active task memory at all (or task gone) — nothing to do. Don't
      // archive (there's nothing to archive) and don't touch project memory.
      if (!layer2.task) {
        console.log(`[memory.promote] skip task=${taskId} reason=no-input`)
        return { outcome: 'skipped' }
      }

      const facts = layer2.facts ?? []

      // Layer 2 ran but decided nothing generalizes. Still archive task
      // memory — it has served its purpose for this task and shouldn't
      // accumulate in the active set forever.
      if (facts.length === 0) {
        const archived = await memoryRepository.archiveAllForTask(taskId)
        console.log(
          `[memory.promote] no-promote task=${taskId} archived=${archived.count}`
        )
        return { outcome: 'no-promote', archived: archived.count }
      }

      const layer3Input = await getLayer3Input({
        projectId: layer2.task.projectId,
        workspaceId: layer2.task.workspaceId,
        distilledFacts: facts,
      })
      const operations = await extractLayer3Operations(layer3Input)

      const { plans, counters } = buildLayer3Plans({
        operations,
        projectId: layer2.task.projectId,
        workspaceId: layer2.task.workspaceId,
        existingMemories: layer3Input.existingProjectMemories.map(m => ({
          id: m.id,
          category: m.category,
        })),
      })

      let archivedCount = 0
      await prisma.$transaction(async tx => {
        for (const plan of plans) await plan(tx)
        const archived = await memoryRepository.archiveAllForTask(taskId, tx)
        archivedCount = archived.count
      })

      console.log(
        `[memory.promote] applied task=${taskId} project=${layer2.task.projectId}`,
        { ...counters, archived: archivedCount }
      )
      return { outcome: 'applied', layer3: counters, archived: archivedCount }
    } catch (error) {
      console.error(`[memory.promote] unexpected error task=${taskId}:`, error)
      return { outcome: 'skipped' }
    }
  },
}
