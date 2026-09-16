import { Prisma } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import { loadMemoryWriteGate } from '@/lib/services/memory/write-gate'
import { lineageService } from '@/lib/services/lineage.service'
import type { FoldProposal } from '@/lib/memory/fold-schemas'
import { logger } from '@/lib/logger'
import type { MemoryWriteGate } from '@/lib/services/memory/write-gate'

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
  /** LUM-555 guardrail: fold should have produced cards (it had proposals, or
   *  its LLM pipeline degraded) but folded nothing — prune was deliberately
   *  SKIPPED so a fold-apply failure can't masquerade as a clean convergence
   *  (the LUM-553 prod incident: 0 folded, whole overflow pruned). The project
   *  is left over cap on purpose; the failure is logged at error level. */
  foldFailed?: boolean
}

/** Days a card is shielded from pruning after creation — too new to have had a
 *  fair chance to be used (it may simply not have come up yet). */
const PRUNE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Pure: pick up to `n` cards to archive to bring a project down to the cap, when
 * folding alone can't (singletons that don't cluster). Ranks by the judged-used
 * track record: only cards NEVER judged-used by any task are eligible (a card
 * that has ever helped is never pruned), oldest first (longest dead weight), and
 * cards inside the grace window are protected (too new to judge — this also
 * shields the just-created coarse cards). "Never judged-used" here includes
 * not-yet-audited (count 0), so this is the aggressive budget enforcer that can
 * actually reach the cap — but only ever ARCHIVES (reversible), never deletes.
 */
export function selectPruneTargets(
  active: Array<{ id: string; createdAt: Date }>,
  judgedUsedById: (id: string) => number,
  n: number,
  now: number
): string[] {
  if (n <= 0) return []
  return active
    .filter(m => judgedUsedById(m.id) === 0)
    .filter(m => now - m.createdAt.getTime() > PRUNE_GRACE_MS)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, n)
    .map(m => m.id)
}

/**
 * Archive (reversibly) the `n` least-valuable cards to reach the cap. Reads the
 * post-fold ACTIVE set + judged-used track record, selects via
 * `selectPruneTargets`, and archives through the existing status machine
 * (ACTIVE→ARCHIVED, restorable; never a hard delete). Returns how many archived.
 */
async function pruneToCap(
  projectId: string,
  workspaceId: string,
  n: number
): Promise<number> {
  if (n <= 0) return 0
  const active = await memoryRepository.findActiveProjectMemories(projectId)
  const trust = await lineageService.fragmentTrustForMemories(
    active.map(m => m.id)
  )
  const ids = selectPruneTargets(
    active,
    id => trust[id]?.judgedUsedTasks ?? 0,
    n,
    Date.now()
  )
  if (ids.length === 0) return 0
  const res = await memoryRepository.archiveMemoriesInWorkspace(
    ids,
    workspaceId
  )
  return res.count
}

/**
 * Apply one proposal: many→one supersede, then best-effort embed the coarse
 * card. The coarse card is LLM-written text about to become a resident
 * PROJECT memory, so it passes the LUM-793 write gate like any other write —
 * a rejected proposal is dropped (the sources stay ACTIVE and the pass moves
 * to the next cluster) rather than folded into a poisoned card.
 */
export async function applyFold(
  projectId: string,
  workspaceId: string,
  proposal: FoldProposal,
  sourceSessionId: string | null,
  gate: MemoryWriteGate
): Promise<void> {
  const screened = gate.screen(proposal.category, proposal.coarseContent)
  if (!screened.ok) {
    throw Object.assign(
      new Error(`fold aborted: coarse card rejected — ${screened.message}`),
      { status: 422 }
    )
  }
  const { coarseId } = await memoryRepository.foldInto({
    sourceIds: proposal.sourceIds,
    coarseContent: proposal.coarseContent as Prisma.InputJsonValue,
    category: proposal.category,
    projectId,
    workspaceId,
    sourceSessionId,
    contentSignals: screened.signals,
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
        const { proposals, degraded } = await computeProjectFoldProposals(
          projectId,
          { maxProposals: FOLD_MAX_CLUSTERS_PER_RUN }
        )
        proposals.sort((a, b) => b.sourceIds.length - a.sourceIds.length)
        const writeGate = await loadMemoryWriteGate(projectId)
        let remaining = active.length
        let folded = 0
        for (const proposal of proposals) {
          if (remaining <= MEMORY_CAP) break // back within budget — stop early
          try {
            await applyFold(
              projectId,
              state.workspaceId,
              proposal,
              sourceSessionId,
              writeGate
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

        // 2a. Guardrail (LUM-555): if fold SHOULD have produced cards — it had
        // proposals, or its LLM pipeline degraded — but folded nothing, do NOT
        // let prune archive the overflow. Pruning here would mask a fold-apply
        // failure as a clean convergence (the LUM-553 prod incident: 0 folded,
        // whole overflow pruned, looked like success). Leave the project over
        // cap on purpose and surface the failure loudly.
        if (
          remaining > MEMORY_CAP &&
          folded === 0 &&
          (degraded || proposals.length > 0)
        ) {
          logger.error(
            `[memory.fold] fold produced no cards despite work to do — skipping ` +
              `prune so the failure isn't masked as convergence project=${projectId} ` +
              `proposals=${proposals.length} degraded=${degraded}`
          )
          return { folded, pruned: 0, foldFailed: true }
        }

        // 2b. Folding alone can't touch singletons — archive (reversibly) the
        // oldest never-judged-used cards the rest of the way to the cap.
        const pruned =
          remaining > MEMORY_CAP
            ? await pruneToCap(
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
