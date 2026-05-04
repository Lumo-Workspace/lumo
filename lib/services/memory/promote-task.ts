import { prisma } from '@/lib/db/prisma'
import { layer2Service } from './layer2.service'
import { getLayer3Input } from './layer3-input'
import { extractLayer3Operations } from './layer3-extract'
import { buildLayer3Plans, type Layer3ApplyResult } from './layer3-apply'

export interface PromoteTaskResult {
  /** "skipped" — task / its memories not found; nothing to do. */
  /** "no-promote" — Layer 2 ran, returned 0 facts; nothing to merge. */
  /** "applied" — Layer 3 produced operations; project memory updated. */
  outcome: 'skipped' | 'no-promote' | 'applied'
  layer3?: Layer3ApplyResult
}

/**
 * Run the full task-done memory promotion: Layer 2 distills task memory →
 * Layer 3 merges into project memory. Task-scoped memories are left in
 * place — they remain visible on the task detail page after the task is
 * done, and the L1 extraction loop can still UPDATE / DELETE them on later
 * sessions.
 *
 * Owns its own error handling — never throws. Caller (status-update side
 * effect) runs under `waitUntil()` and does not see exceptions thrown after
 * the response has been returned.
 */
export const promoteTaskService = {
  async promoteTaskMemory(taskId: string): Promise<PromoteTaskResult> {
    try {
      const layer2 = await layer2Service.consolidateTaskMemory(taskId)

      // No active task memory at all (or task gone) — nothing to do.
      if (!layer2.task) {
        console.log(`[memory.promote] skip task=${taskId} reason=no-input`)
        return { outcome: 'skipped' }
      }

      const facts = layer2.facts ?? []

      // Layer 2 ran but decided nothing generalizes. Nothing to merge into
      // project memory.
      if (facts.length === 0) {
        console.log(`[memory.promote] no-promote task=${taskId}`)
        return { outcome: 'no-promote' }
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

      await prisma.$transaction(async tx => {
        for (const plan of plans) await plan(tx)
      })

      console.log(
        `[memory.promote] applied task=${taskId} project=${layer2.task.projectId}`,
        counters
      )
      return { outcome: 'applied', layer3: counters }
    } catch (error) {
      console.error(`[memory.promote] unexpected error task=${taskId}:`, error)
      return { outcome: 'skipped' }
    }
  },
}
