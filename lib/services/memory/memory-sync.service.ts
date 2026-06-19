import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  lineageEdgeRepository,
  type FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import { computeFragmentTrust, trustKey } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
import type { RenderableMemory } from '@/lib/memory/render'
import { rankForSync } from '@/lib/services/memory/sync-bundle'
import {
  toSyncEntry,
  type ShapedSyncBundle,
} from '@/lib/services/memory/sync-file-shape'

export interface BuildBundleOptions {
  syncedAtIso?: string
}

export const memorySyncService = {
  /**
   * Build the downsync bundle for a project: the project's full ACTIVE memory
   * set, ordered by judge-used 履历 (LUM-539) and rendered into Claude Code
   * local-file shape. Pure selection logic lives in {@link rankForSync} /
   * {@link toSyncEntry}; this orchestrates the two reads and the shaping.
   *
   * LUM-552: sync mirrors the *whole* project's ACTIVE memory — no per-recipient
   * task-level routing and no token-budget cap on the corpus. Sync only writes
   * local files (no tokens, no conversation), so "which memory is relevant" is
   * recall's job (Claude Code native), not sync's. Filtering at sync time was
   * the LUM-535 base-rate bug carried into the wrong layer, and worse: routing
   * by the recipient's current task deleted exactly the unknown-unknowns team
   * memory exists to surface. Project-level routing (don't sync a project you're
   * not in) stays — it lives in the API route's authorization, not here.
   * Relevance/budget gating remains only on the injection path (task-context).
   */
  async buildBundle(
    projectId: string,
    opts: BuildBundleOptions = {}
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

    // Ranking only orders the resident index (judge-used first); it never drops
    // a memory — the full ACTIVE set is mirrored.
    const ranked = rankForSync(memories, { trustById })
    const stamp = opts.syncedAtIso ?? new Date().toISOString()
    return { projectId, entries: ranked.map(m => toSyncEntry(m, stamp)) }
  },
}
