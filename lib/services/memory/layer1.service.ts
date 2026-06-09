import { logger } from '@/lib/logger'
import { getLayer1Input } from './layer1-input'
import {
  extractLayer1Candidates,
  reconcileLayer1Candidates,
} from './layer1-extract'
import { applyLayer1Operations } from './layer1-apply'
import { memoryContentToText } from '@/lib/memory/content-text'
import { NEIGHBOR_K } from './neighbor-retriever'
import { compositeNeighborRetriever } from './embedding-neighbor-retriever'
import { embedTexts } from '@/lib/ai/embedding'

interface TriggerLayer1Input {
  sessionId: string
  taskId: string | null
  workspaceId: string
}

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

      // Batch-embed candidate texts for semantic retrieval. No key / gateway down →
      // degrade to lexical (vectors stay undefined). Never throws (fire-and-forget).
      const candidateTexts = candidates.map(c => memoryContentToText(c.category, c.content))
      let candidateVectors: (number[] | undefined)[] = candidateTexts.map(() => undefined)
      try {
        const vecs = await embedTexts(candidateTexts)
        if (vecs.length === candidateTexts.length) candidateVectors = vecs
      } catch (error) {
        logger.warn(`[memory.layer1] candidate embedding failed, falling back to lexical:`, error instanceof Error ? error.message : error)
      }

      // Retrieve — per candidate, top-k similar existing task memories.
      const neighborsByCandidate = await Promise.all(
        candidates.map((c, i) =>
          compositeNeighborRetriever.retrieve({
            query: { category: c.category, text: candidateTexts[i]!, vector: candidateVectors[i] },
            pool: layer1Input.existingMemories,
            scope: { kind: 'TASK', taskId: layer1Input.task.id },
            k: NEIGHBOR_K,
          })
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

      const precomputedEmbeddings = new Map<string, number[]>()
      candidateTexts.forEach((t, i) => { const v = candidateVectors[i]; if (v) precomputedEmbeddings.set(t, v) })

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
        precomputedEmbeddings,
      })

      logger.debug(`[memory.layer1] applied session=${input.sessionId} task=${input.taskId}`, result)
    } catch (error) {
      console.error(`[memory.layer1] unexpected error session=${input.sessionId}:`, error)
    }
  },
}
