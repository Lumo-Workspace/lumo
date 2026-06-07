import { logger } from '@/lib/logger'
import { getLayer2Input } from './layer2-input'
import { extractLayer2Operations } from './layer2-extract'
import { applyLayer2Operations } from './layer2-apply'
import { memoryRepository } from '@/lib/repositories/memory.repository'

/**
 * Lease TTL for a single consolidation run. Sized to comfortably cover one
 * haiku extraction call; if a run dies mid-flight the lease self-expires and
 * the next completion can re-acquire it.
 */
const LAYER2_LEASE_TTL_MS = 60_000

export interface Layer2ProjectResult {
  added: number
  updated: number
  noop: number
  skipped: number
}

interface TriggerForTaskCompletionInput {
  taskId: string
  projectId: string
  /**
   * Claude Code session that marked the task done (CLI path). Threaded onto
   * the consolidated PROJECT memories so the next session-start can surface
   * them for review (LUM-165). Undefined for Web UI / non-CLI triggers.
   */
  sourceSessionId?: string | null | undefined
}

/**
 * Layer 2 memory consolidation: scans recent TASK-scope memories in a
 * project, identifies recurring lessons, and promotes them to PROJECT
 * scope via the
 *   getLayer2Input → extractLayer2Operations → applyLayer2Operations
 * pipeline.
 *
 * Triggered when a task transitions to DONE — that's the natural moment
 * for the lesson to sediment, and it gives the next agent on a sibling
 * task immediate access to the promoted memory. The previous cron-based
 * trigger was retired in LUM-72; the event-driven trigger uses the same
 * `waitUntil` fire-and-forget pattern as Layer 1.
 */
export const layer2Service = {
  /**
   * Fire-and-forget entrypoint invoked when a task transitions to DONE.
   * Owns its own error handling — must never throw, since the caller wraps
   * this in `waitUntil(...)` after returning the HTTP response.
   *
   * Multiple completions on the same project in quick succession will each
   * fire a run. Layer 2 is idempotent (the LLM sees existing PROJECT
   * memories and emits NOOP/UPDATE when a pattern is already represented),
   * so back-to-back runs converge without duplication. v1 deliberately
   * skips debouncing because the haiku call is cheap; revisit if logs show
   * sustained burst patterns.
   */
  async triggerForTaskCompletion(
    input: TriggerForTaskCompletionInput
  ): Promise<void> {
    try {
      logger.debug(
        `[memory.layer2] triggered task=${input.taskId} project=${input.projectId}`
      )
      await runForProject(input.projectId, input.sourceSessionId ?? null)
    } catch (error) {
      console.error(
        `[memory.layer2] unexpected error project=${input.projectId}:`,
        error
      )
    }
  },

  /**
   * Run the consolidation pipeline once for a single project. Exposed so
   * tests and any future maintenance tool (e.g. an admin reprocess) can
   * call it directly. Returns null when the project has nothing to
   * consolidate (no TASK memories or project missing).
   */
  async runForProject(
    projectId: string,
    sourceSessionId?: string | null
  ): Promise<Layer2ProjectResult | null> {
    return runForProject(projectId, sourceSessionId ?? null)
  },
}

async function runForProject(
  projectId: string,
  sourceSessionId: string | null = null
): Promise<Layer2ProjectResult | null> {
  // Serialize consolidation per project. Concurrent task completions fan out
  // through `waitUntil` (possibly on separate serverless instances), so the
  // only safe lock is the DB row. Without this, two runs each read a stale
  // pre-LLM snapshot, both decide a recurring lesson isn't promoted yet, and
  // both ADD it — producing duplicate PROJECT memories. A run that can't claim
  // the lease skips this round; the lesson stays in the recent-TASK window and
  // is reconsidered on the next completion.
  const now = new Date()
  const until = new Date(now.getTime() + LAYER2_LEASE_TTL_MS)
  const claimed = await memoryRepository.tryClaimLayer2Lease(
    projectId,
    until,
    now
  )
  if (!claimed) {
    logger.debug(`[memory.layer2] skip project=${projectId} reason=locked`)
    return null
  }

  try {
    const input = await getLayer2Input(projectId)
    if (!input) {
      logger.debug(`[memory.layer2] skip project=${projectId} reason=no-input`)
      return null
    }

    const operations = await extractLayer2Operations(input)
    if (operations.length === 0) {
      logger.debug(
        `[memory.layer2] no-ops project=${projectId} (LLM returned empty list)`
      )
      return { added: 0, updated: 0, noop: 0, skipped: 0 }
    }

    const result = await applyLayer2Operations({
      operations,
      projectId: input.project.id,
      workspaceId: input.project.workspaceId,
      existingProjectMemories: input.existingProjectMemories.map(m => ({
        id: m.id,
        category: m.category,
      })),
      validSourceMemoryIds: input.taskMemories.map(m => m.id),
      sourceSessionId,
    })

    logger.debug(`[memory.layer2] applied project=${projectId}`, result)

    return {
      added: result.added,
      updated: result.updated,
      noop: result.noop,
      skipped: result.skipped,
    }
  } finally {
    await memoryRepository.releaseLayer2Lease(projectId)
  }
}
