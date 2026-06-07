import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { logger } from '@/lib/logger'

export interface SessionStartEdgeInput {
  workspaceId: string
  taskId: string
  /** Always present — callers must guard `binding.bound` + sessionId first. */
  sessionId: string
  /** Fragments actually injected this session-start (post-budget). */
  fragments: FragmentRef[]
}

/** Stable key for in-memory de-dup, mirrors the DB unique constraint's fragment half. */
function fragmentKey(f: FragmentRef): string {
  return `${f.fragmentType}::${f.fragmentId}`
}

export const lineageService = {
  /**
   * Persist one lineage edge per fragment a bound session consumed at
   * session-start. MEMORY ids are canonicalized (promoted PROJECT id, not the
   * pre-consolidation TASK cuid). Duplicates that collapse after canonicalization
   * are dropped in-memory; the DB unique index + `skipDuplicates` absorb re-fires
   * of the same session. `outcome` is left UNKNOWN (stamped later by LUM-277);
   * `runId` stays NULL (session-start precedes any agent run).
   *
   * Best-effort: must never throw — it runs inside the hook's `waitUntil` and a
   * failure must not affect context injection.
   */
  async recordSessionStartEdges(input: SessionStartEdgeInput): Promise<void> {
    try {
      const { workspaceId, taskId, sessionId, fragments } = input
      if (fragments.length === 0) return

      const resolved: FragmentRef[] = await Promise.all(
        fragments.map(async f => ({
          fragmentType: f.fragmentType,
          fragmentId: await memoryProvenanceRepository.resolveCanonicalFragment(
            f.fragmentType,
            f.fragmentId
          ),
        }))
      )

      const seen = new Set<string>()
      const unique = resolved.filter(f => {
        const key = fragmentKey(f)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await lineageEdgeRepository.createMany(
        unique.map(f => ({
          workspaceId,
          taskId,
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
          sessionId,
        }))
      )
    } catch (err) {
      // Best-effort: log and swallow.
      logger.error('lineageService.recordSessionStartEdges failed', err)
    }
  },
}
