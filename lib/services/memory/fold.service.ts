import { Prisma } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import type { FoldProposal } from '@/lib/memory/fold-schemas'
import { logger } from '@/lib/logger'

/** Only fold projects with at least this many ACTIVE PROJECT memories — the
 *  "又多又细" condition; small corpora aren't worth an LLM pass. */
export const FOLD_TRIGGER_FLOOR = 40
/** Minimum gap between fold attempts on one project (6 days). The daily cron ×
 *  this interval → each project folds ~weekly and idle projects rarely burn LLM. */
export const FOLD_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000
/** Lease TTL while a fold pass runs for a project (shared Layer-2 lease row). */
const FOLD_LEASE_TTL_MS = 10 * 60 * 1000

export interface TriggerResult {
  folded: number
  skipped?: 'below-floor' | 'cooldown' | 'no-project' | 'locked'
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
   * Autonomous fold entry for one project (called by the daily cron). Throttled:
   * active-count floor → per-project cooldown → the shared Layer-2 project lease.
   * On pass: stamp the attempt, compute proposals, apply each. Best-effort — any
   * error is swallowed (a cron over many projects must not abort on one), and the
   * lease is always released.
   */
  async triggerForProject(
    projectId: string,
    sourceSessionId: string | null = null
  ): Promise<TriggerResult> {
    try {
      const active = await memoryRepository.findActiveProjectMemories(projectId)
      if (active.length < FOLD_TRIGGER_FLOOR) {
        return { folded: 0, skipped: 'below-floor' }
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
        const proposals = await computeProjectFoldProposals(projectId)
        let folded = 0
        for (const proposal of proposals) {
          try {
            await applyFold(
              projectId,
              state.workspaceId,
              proposal,
              sourceSessionId
            )
            folded++
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
