import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  lineageEdgeRepository,
  type FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import { computeFragmentTrust, trustKey } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
import { applyTokenBudget, type RenderableMemory } from '@/lib/memory/render'
import { rankForSync } from '@/lib/services/memory/sync-bundle'
import {
  toSyncEntry,
  type ShapedSyncBundle,
} from '@/lib/services/memory/sync-file-shape'

export const memorySyncService = {
  /**
   * Build the downsync bundle for a project: ACTIVE project memories, ranked by
   * judge-used 履历 (LUM-539) with cold-start grace, capped to the resident-index
   * budget, rendered into Claude Code local-file shape. Pure selection logic
   * lives in {@link rankForSync} / {@link toSyncEntry}; this orchestrates the
   * two reads and the budget cap.
   */
  async buildBundle(
    projectId: string,
    syncedAtIso?: string
  ): Promise<ShapedSyncBundle> {
    const memories = (await memoryRepository.listForProject(
      projectId
    )) as RenderableMemory[]
    if (memories.length === 0) return { projectId, entries: [] }

    const refs: FragmentRef[] = memories.map(m => ({
      fragmentType: 'MEMORY',
      fragmentId: m.id,
    }))
    const judged = await lineageEdgeRepository.judgedUsageByFragments(refs)
    const { verdicts } = computeFragmentTrust(refs, { judged })

    // computeFragmentTrust keys by `MEMORY::<id>`; rankForSync wants bare ids.
    const trustById = new Map<string, TrustVerdict>()
    for (const m of memories) {
      const v = verdicts.get(trustKey('MEMORY', m.id))
      if (v) trustById.set(m.id, v)
    }

    const ranked = rankForSync(memories, { trustById })
    const capped = applyTokenBudget(ranked)
    const stamp = syncedAtIso ?? new Date().toISOString()
    return { projectId, entries: capped.map(m => toSyncEntry(m, stamp)) }
  },
}
