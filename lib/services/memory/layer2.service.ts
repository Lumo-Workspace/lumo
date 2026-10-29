import { logger } from '@/lib/logger'
import { getLayer2Input } from './layer2-input'
import {
  extractLayer2Candidates,
  reconcileLayer2Candidates,
} from './layer2-extract'
import { applyLayer2Operations } from './layer2-apply'
import { groundCandidates } from './ground-candidates'
import { buildLayer2SourceText } from './layer2-prompt'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryContentToText } from '@/lib/memory/content-text'
import { NEIGHBOR_K } from './neighbor-retriever'
import { compositeNeighborRetriever } from './embedding-neighbor-retriever'
import { embedTexts } from '@/lib/ai/embedding'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { isMemoryPipelineDisabled } from '@/lib/memory/pipeline-switch'

/**
 * Lease TTL for a single consolidation run. Sized to comfortably cover one
 * haiku extraction call; if a run dies mid-flight the lease self-expires and
 * the next completion can re-acquire it.
 */
const LAYER2_LEASE_TTL_MS = 60_000

export interface Layer2ProjectResult {
  added: number
  updated: number
  superseded: number
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
 * scope via the two-pass
 *   getLayer2Input → extractLayer2Candidates → groundCandidates
 *   (quote-or-discard, LUM-396) → retrieveNeighbors →
 *   reconcileLayer2Candidates → applyLayer2Operations
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
      // LUM-1314: the global memory pipeline switch is on.
      if (isMemoryPipelineDisabled()) {
        logger.debug(
          `[memory.layer2] skip project=${input.projectId} reason=memory-pipeline-off`
        )
        return
      }
      // LUM-917: the workspace turned AI-derived content off.
      if (
        !(await aiDerivedContentService.isEnabled({
          projectId: input.projectId,
        }))
      ) {
        logger.debug(
          `[memory.layer2] skip project=${input.projectId} reason=ai-derived-off`
        )
        return
      }
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

    // Pass 1 — candidate project lessons, blind to existing PROJECT memories.
    const rawCandidates = await extractLayer2Candidates(input)
    if (rawCandidates.length === 0) {
      logger.debug(`[memory.layer2] no-candidates project=${projectId}`)
      return { added: 0, updated: 0, superseded: 0, noop: 0, skipped: 0 }
    }

    // Grounding gate (LUM-396) — quote-or-discard against the same TASK-memory
    // window the extract pass read. MUST run before neighbor retrieval /
    // reconcile: a hallucinated lesson that reaches reconcile can trigger
    // SUPERSEDE and invalidate a good existing PROJECT memory. Fail-open inside.
    const { kept: candidates } = await groundCandidates({
      sourceText: buildLayer2SourceText(input.taskMemories),
      candidates: rawCandidates,
      logTag: 'memory.layer2',
    })
    if (candidates.length === 0) {
      logger.debug(
        `[memory.layer2] no-grounded-candidates project=${projectId}`
      )
      return { added: 0, updated: 0, superseded: 0, noop: 0, skipped: 0 }
    }

    // Batch-embed candidate texts for semantic retrieval. No key / gateway down →
    // degrade to lexical (vectors stay undefined). Never throws (fire-and-forget).
    const candidateTexts = candidates.map(c =>
      memoryContentToText(c.category, c.content)
    )
    let candidateVectors: (number[] | undefined)[] = candidateTexts.map(
      () => undefined
    )
    try {
      const vecs = await embedTexts(candidateTexts)
      if (vecs.length === candidateTexts.length) candidateVectors = vecs
    } catch (error) {
      logger.warn(
        `[memory.layer2] candidate embedding failed, falling back to lexical:`,
        error instanceof Error ? error.message : error
      )
    }

    // Retrieve — per candidate, top-k similar existing PROJECT memories.
    const neighborsByCandidate = await Promise.all(
      candidates.map((c, i) =>
        compositeNeighborRetriever.retrieve({
          query: {
            category: c.category,
            text: candidateTexts[i]!,
            vector: candidateVectors[i],
          },
          pool: input.existingProjectMemories,
          scope: { kind: 'PROJECT', projectId: input.project.id },
          k: NEIGHBOR_K,
        })
      )
    )

    // Pass 2 — reconcile each candidate against its neighbors.
    const operations = await reconcileLayer2Candidates({
      project: { id: input.project.id, name: input.project.name },
      candidates,
      neighborsByCandidate,
    })
    if (operations.length === 0) {
      logger.debug(`[memory.layer2] no-ops project=${projectId}`)
      return { added: 0, updated: 0, superseded: 0, noop: 0, skipped: 0 }
    }

    const precomputedEmbeddings = new Map<string, number[]>()
    candidateTexts.forEach((t, i) => {
      const v = candidateVectors[i]
      if (v) precomputedEmbeddings.set(t, v)
    })

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
      precomputedEmbeddings,
    })

    logger.debug(`[memory.layer2] applied project=${projectId}`, result)
    return {
      added: result.added,
      updated: result.updated,
      superseded: result.superseded,
      noop: result.noop,
      skipped: result.skipped,
    }
  } finally {
    await memoryRepository.releaseLayer2Lease(projectId)
  }
}
