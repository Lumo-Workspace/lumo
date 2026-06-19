import { Prisma } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import type { FoldProposal } from '@/lib/memory/fold-schemas'
import { logger } from '@/lib/logger'

/** Target resident ACTIVE PROJECT memory budget — the MEMORY.md-style cap. The
 *  fold pass runs only when a project is OVER this, and folds the corpus down
 *  toward it (best-effort; fold-only can't always reach it — singletons that
 *  don't cluster stay). */
export const MEMORY_CAP = 60
/** Max clusters folded per cron run — bounds one serverless invocation's LLM
 *  time (a full backlog can exceed the function timeout). The backlog converges
 *  over runs; the one-time offline backfill is unbounded. */
export const FOLD_MAX_CLUSTERS_PER_RUN = 6
/** Minimum gap between fold attempts on one project (6 days). The daily cron ×
 *  this interval → each project folds ~weekly and idle projects rarely burn LLM. */
export const FOLD_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000
/** Lease TTL while a fold pass runs for a project (shared Layer-2 lease row). */
const FOLD_LEASE_TTL_MS = 10 * 60 * 1000

export interface TriggerResult {
  folded: number
  skipped?: 'within-cap' | 'cooldown' | 'no-project' | 'locked'
  error?: boolean
}

/** Apply one proposal: many→one supersede, then best-effort embed the coarse card. */
async function applyFold(
  projectId: string,
  workspaceId: string,
  proposal: FoldProposal,
  sourceSessionId: string | null
): Promise<void> {
  const { coarseId } = await memoryRepository.foldInto({
    sourceIds: proposal.sourceIds,
    coarseContent: proposal.coarseContent as Prisma.InputJsonValue,
    category: proposal.category,
    projectId,
    workspaceId,
    sourceSessionId,
  })
  try {
    const [vec] = await embedTexts([
      memoryContentToText(proposal.category, proposal.coarseContent),
    ])
    if (vec) await memoryRepository.setEmbedding(coarseId, vec)
  } catch (error) {
    logger.warn(
      `[memory.fold] coarse embed failed coarse=${coarseId}:`,
      error instanceof Error ? error.message : error
    )
  }
}

export const foldService = {
  /**
   * Autonomous fold entry for one project (called by the daily cron). Runs only
   * when the project is OVER the MEMORY_CAP, then folds toward it. Throttled:
   * over-cap → per-project cooldown → the shared Layer-2 project lease. Folds the
   * biggest clusters first (most reduction), at most FOLD_MAX_CLUSTERS_PER_RUN
   * per run, stopping once the projected count is back within cap. Best-effort —
   * any error is swallowed (a cron over many projects must not abort on one), and
   * the lease is always released.
   */
  async triggerForProject(
    projectId: string,
    sourceSessionId: string | null = null
  ): Promise<TriggerResult> {
    try {
      const active = await memoryRepository.findActiveProjectMemories(projectId)
      if (active.length <= MEMORY_CAP) {
        return { folded: 0, skipped: 'within-cap' }
      }

      const state = await projectRepository.findFoldState(projectId)
      if (!state) return { folded: 0, skipped: 'no-project' }

      const now = new Date()
      if (
        state.lastMemoryFoldAttemptAt &&
        now.getTime() - state.lastMemoryFoldAttemptAt.getTime() <
          FOLD_COOLDOWN_MS
      ) {
        return { folded: 0, skipped: 'cooldown' }
      }

      const until = new Date(now.getTime() + FOLD_LEASE_TTL_MS)
      const claimed = await memoryRepository.tryClaimLayer2Lease(
        projectId,
        until,
        now
      )
      if (!claimed) return { folded: 0, skipped: 'locked' }

      try {
        await projectRepository.stampFoldAttempt(projectId, now)
        // Bound the compute to ~K clusters (serverless time budget), biggest
        // first (each fold of N sources reduces the count by N-1).
        const proposals = await computeProjectFoldProposals(projectId, {
          maxProposals: FOLD_MAX_CLUSTERS_PER_RUN,
        })
        proposals.sort((a, b) => b.sourceIds.length - a.sourceIds.length)
        let remaining = active.length
        let folded = 0
        for (const proposal of proposals) {
          if (remaining <= MEMORY_CAP) break // back within budget — stop early
          try {
            await applyFold(
              projectId,
              state.workspaceId,
              proposal,
              sourceSessionId
            )
            folded++
            remaining -= proposal.sourceIds.length - 1
          } catch (error) {
            // One proposal aborting (e.g. a racing supersede) must not stop the rest.
            logger.warn(
              `[memory.fold] apply skipped project=${projectId}:`,
              error instanceof Error ? error.message : error
            )
          }
        }
        return { folded }
      } finally {
        await memoryRepository.releaseLayer2Lease(projectId)
      }
    } catch (error) {
      logger.warn(
        `[memory.fold] triggerForProject failed project=${projectId}:`,
        error instanceof Error ? error.message : error
      )
      return { folded: 0, error: true }
    }
  },
}
