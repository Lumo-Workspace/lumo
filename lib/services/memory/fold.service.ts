import { Prisma } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'
import type { FoldProposal } from '@/lib/memory/fold-schemas'
import { logger } from '@/lib/logger'

/** Target resident ACTIVE PROJECT memory budget — the MEMORY.md-style cap the
 *  fold pass shrinks a project back down to (best-effort; fold-only can't always
 *  reach it — singletons that don't cluster stay). */
export const MEMORY_CAP = 60
/** High-water mark: folding only kicks in once a project's ACTIVE PROJECT memory
 *  GROWS past this, then folds back down to MEMORY_CAP. The gap (80 → 60) is
 *  hysteresis — ~20 new cards must accrue before folding runs again, so it
 *  doesn't thrash on every memory write. */
export const MEMORY_HIGH_WATER = 80
/** Max clusters folded per trigger — bounds one serverless invocation's LLM time
 *  (the steady-state fold of ~20 cards is small; this just caps a burst). The
 *  one-time offline backfill (scripts/fold-backfill.ts) is unbounded. */
export const FOLD_MAX_CLUSTERS_PER_RUN = 6
/** Backstop against re-running on every task completion in a busy window — at
 *  most one fold/prune pass per project per hour (the 80→60 hysteresis is the
 *  primary throttle; this just bounds bursts). */
export const FOLD_COOLDOWN_MS = 60 * 60 * 1000
/** Lease TTL while a fold pass runs for a project (shared Layer-2 lease row). */
const FOLD_LEASE_TTL_MS = 10 * 60 * 1000

export interface TriggerResult {
  /** coarse cards created (related fine cards superseded into them). */
  folded: number
  /** never-used cards archived (reversible) to reach the cap when folding alone
   *  couldn't — the "prune" half of the MEMORY.md-style budget. */
  pruned: number
  skipped?: 'within-cap' | 'cooldown' | 'no-project' | 'locked'
  error?: boolean
}

/**
 * Archive (reversibly) up to `n` never-used cards to bring a project down to the
 * cap when folding alone can't (singletons that don't cluster). Reuses the P4
 * retire signal — only cards that passed the cold-start grace AND were never
 * judged-used by any task — and archives them through the existing status
 * machine (ACTIVE→ARCHIVED, restorable; never a hard delete). Returns how many
 * were archived (0 if there aren't enough never-used cards — best-effort).
 */
async function pruneNeverUsedToCap(
  projectId: string,
  workspaceId: string,
  n: number
): Promise<number> {
  if (n <= 0) return 0
  const candidates = await computeProjectRetireCandidates(projectId)
  const neverUsed = candidates
    .filter(c => c.reasons.includes('low-judged-used'))
    .map(c => c.memoryId)
    .slice(0, n)
  if (neverUsed.length === 0) return 0
  const res = await memoryRepository.archiveMemoriesInWorkspace(
    neverUsed,
    workspaceId
  )
  return res.count
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
   * Budget-maintenance entry for one project. Fired in the background after a
   * task completes (when Layer-2 may have grown the project's PROJECT memory).
   * Runs only once the count has GROWN past MEMORY_HIGH_WATER, then brings it
   * back down to MEMORY_CAP — the 80 → 60 hysteresis means it won't run again
   * until ~20 more cards accrue (no thrash, no cron needed). Two info-preserving
   * tools, in order:
   *   1. FOLD related cards into coarse subsystem cards (biggest clusters first);
   *   2. if still over cap, ARCHIVE never-used cards (reversible) down to the cap.
   * Best-effort — any error is swallowed, and the shared Layer-2 lease is always
   * released.
   */
  async triggerForProject(
    projectId: string,
    sourceSessionId: string | null = null
  ): Promise<TriggerResult> {
    try {
      const active = await memoryRepository.findActiveProjectMemories(projectId)
      // Hysteresis: only run once GROWN past the high-water mark.
      if (active.length <= MEMORY_HIGH_WATER) {
        return { folded: 0, pruned: 0, skipped: 'within-cap' }
      }

      const state = await projectRepository.findFoldState(projectId)
      if (!state) return { folded: 0, pruned: 0, skipped: 'no-project' }

      const now = new Date()
      if (
        state.lastMemoryFoldAttemptAt &&
        now.getTime() - state.lastMemoryFoldAttemptAt.getTime() <
          FOLD_COOLDOWN_MS
      ) {
        return { folded: 0, pruned: 0, skipped: 'cooldown' }
      }

      const until = new Date(now.getTime() + FOLD_LEASE_TTL_MS)
      const claimed = await memoryRepository.tryClaimLayer2Lease(
        projectId,
        until,
        now
      )
      if (!claimed) return { folded: 0, pruned: 0, skipped: 'locked' }

      try {
        await projectRepository.stampFoldAttempt(projectId, now)

        // 1. Fold related cards (info-preserving) toward the cap. Bound the
        // compute to ~K biggest clusters (each fold of N sources cuts N-1).
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

        // 2. Folding alone can't touch singletons — archive never-used cards
        // (reversible) the rest of the way to the cap.
        const pruned =
          remaining > MEMORY_CAP
            ? await pruneNeverUsedToCap(
                projectId,
                state.workspaceId,
                remaining - MEMORY_CAP
              )
            : 0

        return { folded, pruned }
      } finally {
        await memoryRepository.releaseLayer2Lease(projectId)
      }
    } catch (error) {
      logger.warn(
        `[memory.fold] triggerForProject failed project=${projectId}:`,
        error instanceof Error ? error.message : error
      )
      return { folded: 0, pruned: 0, error: true }
    }
  },
}
