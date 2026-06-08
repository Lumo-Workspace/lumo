import { logger } from '@/lib/logger'
import { getLayer1Input } from './layer1-input'
import {
  extractLayer1Candidates,
  reconcileLayer1Candidates,
} from './layer1-extract'
import { applyLayer1Operations } from './layer1-apply'
import { memoryContentToText } from '@/lib/memory/content-text'
import { lexicalNeighborRetriever, NEIGHBOR_K } from './neighbor-retriever'
import type { NeighborRetriever } from './neighbor-retriever'

interface TriggerLayer1Input {
  sessionId: string
  taskId: string | null
  workspaceId: string
}

/**
 * Neighbor retriever for reconcile-on-write. LUM-324 ships the lexical
 * implementation; swap this single binding for an embedding-backed retriever
 * (pgvector) when the LUM-324 DECISION trigger fires.
 */
const retriever: NeighborRetriever = lexicalNeighborRetriever

/**
 * Fire-and-forget entrypoint invoked from the Stop hook handler. Owns its own
 * error handling — must never throw, since the caller (the hook route) has
 * already returned 200 by the time this runs under `waitUntil(...)`.
 *
 * Two-pass reconcile-on-write:
 *   getLayer1Input → extractLayer1Candidates (Pass 1) → per-candidate neighbor
 *   retrieval → reconcileLayer1Candidates (Pass 2) → applyLayer1Operations.
 * Each step degrades to a no-op on failure rather than propagating.
 */
export const layer1Service = {
  async triggerLayer1Extraction(input: TriggerLayer1Input): Promise<void> {
    try {
      if (!input.taskId) {
        logger.debug(`[memory.layer1] skip session=${input.sessionId} reason=no-task-tag`)
        return
      }
      logger.debug(`[memory.layer1] triggered session=${input.sessionId} task=${input.taskId}`)

      const layer1Input = await getLayer1Input(input.sessionId, input.taskId)
      if (!layer1Input) {
        logger.debug(`[memory.layer1] skip session=${input.sessionId} reason=no-input`)
        return
      }

      // Pass 1 — extract candidate facts, blind to existing memories.
      const candidates = await extractLayer1Candidates(layer1Input)
      if (candidates.length === 0) {
        logger.debug(`[memory.layer1] no-candidates session=${input.sessionId}`)
        return
      }

      // Retrieve — per candidate, top-k similar existing task memories.
      const neighborsByCandidate = candidates.map(c =>
        retriever.retrieve(
          { category: c.category, text: memoryContentToText(c.category, c.content) },
          layer1Input.existingMemories,
          NEIGHBOR_K
        )
      )

      // Pass 2 — reconcile each candidate against its neighbors.
      const operations = await reconcileLayer1Candidates({
        task: {
          id: layer1Input.task.id,
          title: layer1Input.task.title,
          description: layer1Input.task.description,
        },
        candidates,
        neighborsByCandidate,
      })
      if (operations.length === 0) {
        logger.debug(`[memory.layer1] no-ops session=${input.sessionId}`)
        return
      }

      const result = await applyLayer1Operations({
        operations,
        taskId: layer1Input.task.id,
        projectId: layer1Input.task.projectId,
        workspaceId: layer1Input.task.workspaceId,
        sessionId: input.sessionId,
        ...(layer1Input.agent !== undefined ? { agent: layer1Input.agent } : {}),
        existingMemories: layer1Input.existingMemories.map(m => ({
          id: m.id,
          category: m.category,
        })),
      })

      logger.debug(`[memory.layer1] applied session=${input.sessionId} task=${input.taskId}`, result)
    } catch (error) {
      console.error(`[memory.layer1] unexpected error session=${input.sessionId}:`, error)
    }
  },
}
