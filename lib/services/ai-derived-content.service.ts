import {
  aiDerivedContentRepository,
  type AiDerivedContentCounts,
  type AiDerivedSwitchRef,
} from '@/lib/repositories/ai-derived-content.repository'
import { logger } from '@/lib/logger'

/** Rows one repository batch touches. */
export const AI_DERIVED_PURGE_BATCH_SIZE = 500

/**
 * Batches one purge request runs before it returns `done: false` and the
 * client calls again — keeps a request well inside the function budget.
 */
export const AI_DERIVED_PURGE_MAX_BATCHES = 20

export interface AiDerivedContentStatus {
  enabled: boolean
  counts: AiDerivedContentCounts
}

export interface AiDerivedPurgeResult {
  deleted: AiDerivedContentCounts
  /** False when the batch budget ran out first — call again to continue. */
  done: boolean
}

function requireOwner(role: string): void {
  if (role !== 'OWNER') {
    throw Object.assign(
      new Error('Only workspace owners can manage AI-derived content'),
      { status: 403 }
    )
  }
}

/**
 * LUM-917 — the workspace switch for AI-derived content (memories extracted
 * from sessions and their consolidation, session summaries, run summaries)
 * and the OWNER's delete of what was already generated.
 */
export const aiDerivedContentService = {
  /**
   * May AI-derived content be generated for this workspace / project / task /
   * milestone? Fails closed: an unreadable switch generates nothing (this is
   * a privacy control; a skipped memory or summary is recoverable, a
   * generated one the OWNER turned off is not).
   */
  async isEnabled(ref: AiDerivedSwitchRef): Promise<boolean> {
    try {
      return (await aiDerivedContentRepository.findEnabled(ref)) === true
    } catch (err) {
      logger.warn('[ai-derived] switch read failed — generation skipped', {
        ref,
        err,
      })
      return false
    }
  },

  /** OWNER only: the switch and how much derived content is stored. */
  async getStatus(
    workspaceId: string,
    role: string
  ): Promise<AiDerivedContentStatus> {
    requireOwner(role)
    const [enabled, counts] = await Promise.all([
      aiDerivedContentRepository.findEnabled({ workspaceId }),
      aiDerivedContentRepository.countForWorkspace(workspaceId),
    ])
    return { enabled: enabled !== false, counts }
  },

  /**
   * OWNER only, with the workspace name re-typed: delete the workspace's
   * memories (with their embeddings) and clear its session summaries and run
   * summaries. Batched and idempotent — each call removes what is still
   * there, up to the batch budget, and says whether anything is left (`done`).
   */
  async purge(
    workspace: { id: string; name: string },
    role: string,
    confirmName: string
  ): Promise<AiDerivedPurgeResult> {
    requireOwner(role)
    if (confirmName !== workspace.name) {
      throw Object.assign(
        new Error('The workspace name does not match — nothing was deleted'),
        { status: 400 }
      )
    }
    const workspaceId = workspace.id
    const deleted: AiDerivedContentCounts = {
      memories: 0,
      sessionSummaries: 0,
      runSummaries: 0,
    }
    const steps: {
      key: keyof AiDerivedContentCounts
      run: () => Promise<number>
    }[] = [
      {
        key: 'memories',
        run: () =>
          aiDerivedContentRepository.deleteMemoryBatch(
            workspaceId,
            AI_DERIVED_PURGE_BATCH_SIZE
          ),
      },
      {
        key: 'sessionSummaries',
        run: () =>
          aiDerivedContentRepository.clearSessionSummaryBatch(
            workspaceId,
            AI_DERIVED_PURGE_BATCH_SIZE
          ),
      },
      {
        key: 'runSummaries',
        run: () =>
          aiDerivedContentRepository.clearRunSummaryBatch(
            workspaceId,
            AI_DERIVED_PURGE_BATCH_SIZE
          ),
      },
    ]

    let batches = 0
    for (const step of steps) {
      for (;;) {
        if (batches >= AI_DERIVED_PURGE_MAX_BATCHES) {
          return { deleted, done: false }
        }
        batches++
        const n = await step.run()
        deleted[step.key] += n
        if (n < AI_DERIVED_PURGE_BATCH_SIZE) break
      }
    }
    logger.info('[ai-derived] purge pass finished', { workspaceId, deleted })
    return { deleted, done: true }
  },
}
