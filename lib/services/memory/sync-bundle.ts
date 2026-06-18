import type { MemoryCategory, MemoryScope } from '@prisma/client'
import type { RenderableMemory } from '@/lib/memory/render'
import {
  LINEAGE_MIN_AUDITED_TASKS,
  type TrustVerdict,
} from '@/lib/services/lineage-signal'

/**
 * One memory rendered into Claude Code local-file shape. The CLI writes each as
 * `team/<id>.md` and lists it in the MEMORY.md managed block.
 */
export interface MemorySyncEntry {
  id: string
  slug: string
  category: MemoryCategory
  scope: MemoryScope
  description: string
  body: string
  contentHash: string
}

export interface MemorySyncBundle {
  projectId: string
  entries: MemorySyncEntry[]
}

/**
 * Ranking inputs for {@link rankForSync}. Kept as injected maps (not a fixed
 * scorer) so the order policy can evolve without touching the selector — the
 * pluggable-ranker requirement (LUM-537). `trustById` is keyed by bare memory
 * id (the service strips computeFragmentTrust's `MEMORY::` prefix).
 */
export interface SyncRankInputs {
  /** Judge-used 履历 verdicts (LUM-539). Absent id = below cold-start grace. */
  trustById: Map<string, TrustVerdict>
  /** Optional relevance backfill used to break cold-start ties. */
  relevanceScoreById?: Map<string, number>
}

// Three bands, highest sync priority first:
//   0 proven-useful   — cleared cold-start grace AND judged useful (qualified)
//   1 cold-start      — unaudited/thin (unknown) → graced, given a chance
//   2 proven-low-value— audited enough but not qualified (retire-leaning, P4)
// Crucially band 1 ranks ABOVE band 2: an unknown memory (used=null) is treated
// as unknown, never as "unused" — so it outranks a confirmed-low-value one.
function band(v: TrustVerdict | undefined): 0 | 1 | 2 {
  if (!v || v.auditedTasks < LINEAGE_MIN_AUDITED_TASKS) return 1
  return v.qualified ? 0 : 2
}

/**
 * Order memories for downsync: judge-used (LUM-539) primary, relevance backfill
 * for the cold-start band, stable within ties. Pure — no I/O. Budget capping is
 * applied separately (applyTokenBudget) after ranking.
 */
export function rankForSync(
  memories: RenderableMemory[],
  inputs: SyncRankInputs
): RenderableMemory[] {
  return memories
    .map((m, i) => ({ m, i })) // index carries stable order for ties
    .sort((a, b) => {
      const va = inputs.trustById.get(a.m.id)
      const vb = inputs.trustById.get(b.m.id)
      const ba = band(va)
      const bb = band(vb)
      if (ba !== bb) return ba - bb

      if (ba === 0) {
        // proven-useful: usefulness desc, then judged-used count desc
        if (vb!.usefulnessPct !== va!.usefulnessPct)
          return vb!.usefulnessPct - va!.usefulnessPct
        if (vb!.judgedUsedTasks !== va!.judgedUsedTasks)
          return vb!.judgedUsedTasks - va!.judgedUsedTasks
      } else if (ba === 1) {
        // cold-start: relevance backfill desc
        const ra = inputs.relevanceScoreById?.get(a.m.id) ?? 0
        const rb = inputs.relevanceScoreById?.get(b.m.id) ?? 0
        if (rb !== ra) return rb - ra
      } else {
        // proven-low-value: least-bad first (usefulness desc)
        if (vb!.usefulnessPct !== va!.usefulnessPct)
          return vb!.usefulnessPct - va!.usefulnessPct
      }
      return a.i - b.i // stable
    })
    .map(x => x.m)
}
