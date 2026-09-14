import { logger } from '@/lib/logger'
import { getLayer1Input } from './layer1-input'
import { extractLayer1Turn, reconcileLayer1Candidates } from './layer1-extract'
import { applyLayer1Operations } from './layer1-apply'
import { groundCandidatesLocally } from './local-grounding'
import { screenCandidate } from './extraction-gate'
import { loadConstitutionText } from './constitution'
import { classifyTurnSource } from './layer1-prompt'
import { memoryContentToText } from '@/lib/memory/content-text'
import { NEIGHBOR_K } from './neighbor-retriever'
import { compositeNeighborRetriever } from './embedding-neighbor-retriever'
import { embedTexts } from '@/lib/ai/embedding'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

interface TriggerLayer1Input {
  sessionId: string
  taskId: string | null
  workspaceId: string
  /**
   * LUM-773 — the just-inserted STOP event. The combined extraction also
   * produces the one-line turn summary, which is written back here (what the
   * standalone turn-summary call used to do for task-bound sessions).
   */
  stopEventId: string
}

/**
 * Fire-and-forget entrypoint invoked from the Stop hook handler. Owns its own
 * error handling — must never throw, since the caller (the hook route) has
 * already returned 200 by the time this runs under `waitUntil(...)`.
 *
 * One model call per turn (LUM-773), then reconcile-on-write:
 *   getLayer1Input → skip gate (trivial turn) → extractLayer1Turn (summary +
 *   quoted candidates, ONE call) → write summary → groundCandidatesLocally
 *   (quote-in-source, no LLM) → extraction gate → per-candidate neighbor
 *   retrieval → reconcileLayer1Candidates (Pass 2) → applyLayer1Operations.
 * Each step degrades to a no-op on failure rather than propagating.
 */
export const layer1Service = {
  async triggerLayer1Extraction(input: TriggerLayer1Input): Promise<void> {
    try {
      if (!input.taskId) {
        logger.debug(
          `[memory.layer1] skip session=${input.sessionId} reason=no-task-tag`
        )
        return
      }
      logger.debug(
        `[memory.layer1] triggered session=${input.sessionId} task=${input.taskId}`
      )

      const layer1Input = await getLayer1Input(input.sessionId, input.taskId)
      if (!layer1Input) {
        logger.debug(
          `[memory.layer1] skip session=${input.sessionId} reason=no-input`
        )
        return
      }

      // Skip gate (LUM-773) — a tool-less, near-empty turn is not worth a
      // model call; the UI summary falls back to the assistant message.
      const source = classifyTurnSource(layer1Input.turnEvents)
      if (source.trivial) {
        logger.debug(
          `[memory.layer1] skip session=${input.sessionId} reason=trivial-turn chars=${source.text.length}`
        )
        return
      }

      // Pass 1 — ONE call: turn summary + candidate facts (each with a quote),
      // blind to existing memories.
      const extraction = await extractLayer1Turn(layer1Input)
      if (extraction.summary) {
        await hookEventRepository.setTurnSummary(
          input.stopEventId,
          extraction.summary
        )
      }
      if (extraction.candidates.length === 0) {
        logger.debug(`[memory.layer1] no-candidates session=${input.sessionId}`)
        return
      }

      // Grounding gate (LUM-396 → LUM-773 local) — quote-or-discard against
      // the same turn text the extract pass read, checked locally. MUST run
      // before neighbor retrieval / reconcile: a hallucinated candidate that
      // reaches reconcile can trigger SUPERSEDE and invalidate a good memory.
      const { kept: grounded, discardedCount } = groundCandidatesLocally({
        sourceText: source.text,
        candidates: extraction.candidates,
      })
      if (discardedCount > 0) {
        logger.info(
          `[memory.layer1] local grounding kept=${grounded.length} discarded=${discardedCount}`
        )
      }
      if (grounded.length === 0) {
        logger.debug(
          `[memory.layer1] no-grounded-candidates session=${input.sessionId}`
        )
        return
      }

      // Extraction gate (LUM-538) — drop incomplete-fact fragments and entries
      // the project constitution already documents, at the SOURCE. Deterministic
      // (no gateway call). The constitution is the task's PROJECT's own
      // CLAUDE.md / AGENTS.md from its linked repo (LUM-778); the load fails
      // open to null (redundancy check skipped); the incomplete-fact check
      // always runs.
      const constitutionText = await loadConstitutionText({
        projectId: layer1Input.task.projectId,
        workspaceId: layer1Input.task.workspaceId,
      })
      let droppedIncomplete = 0
      let droppedRedundant = 0
      const candidates = grounded.filter(c => {
        const verdict = screenCandidate({
          category: c.category,
          content: c.content,
          constitution: constitutionText,
        })
        if (verdict.ok) return true
        if (verdict.reason === 'INCOMPLETE_FACT') droppedIncomplete++
        else droppedRedundant++
        return false
      })
      if (droppedIncomplete + droppedRedundant > 0) {
        logger.info(
          `[memory.layer1] extraction-gate dropped incomplete=${droppedIncomplete} constitution-redundant=${droppedRedundant} kept=${candidates.length}`
        )
      }
      if (candidates.length === 0) {
        logger.debug(
          `[memory.layer1] no-candidates-after-gate session=${input.sessionId}`
        )
        return
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
          `[memory.layer1] candidate embedding failed, falling back to lexical:`,
          error instanceof Error ? error.message : error
        )
      }

      // Retrieve — per candidate, top-k similar existing task memories.
      const neighborsByCandidate = await Promise.all(
        candidates.map((c, i) =>
          compositeNeighborRetriever.retrieve({
            query: {
              category: c.category,
              text: candidateTexts[i]!,
              vector: candidateVectors[i],
            },
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
      candidateTexts.forEach((t, i) => {
        const v = candidateVectors[i]
        if (v) precomputedEmbeddings.set(t, v)
      })

      const result = await applyLayer1Operations({
        operations,
        taskId: layer1Input.task.id,
        projectId: layer1Input.task.projectId,
        workspaceId: layer1Input.task.workspaceId,
        sessionId: input.sessionId,
        ...(layer1Input.agent !== undefined
          ? { agent: layer1Input.agent }
          : {}),
        existingMemories: layer1Input.existingMemories.map(m => ({
          id: m.id,
          category: m.category,
        })),
        precomputedEmbeddings,
      })

      logger.debug(
        `[memory.layer1] applied session=${input.sessionId} task=${input.taskId}`,
        result
      )
    } catch (error) {
      logger.error(
        `[memory.layer1] unexpected error session=${input.sessionId}:`,
        error
      )
    }
  },
}
