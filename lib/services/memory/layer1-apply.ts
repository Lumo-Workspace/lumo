import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { scanMemoryContent } from '@/lib/services/content-signals'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { resolveGuardedSupersedeIds } from './supersede-guard'
import type { MemoryCategory, Prisma, TaskArtifactAgent } from '@prisma/client'
import type { Layer1Operation } from './layer1-extract'

interface ApplyOperationsInput {
  operations: Layer1Operation[]
  taskId: string
  projectId: string
  workspaceId: string
  sessionId: string
  /**
   * Agent that owns the source session — stamped onto every ADD so the
   * auto-sedimented memory is attributed to the agent that produced it. Omit
   * to fall back to the DB default (CLAUDE_CODE).
   */
  agent?: TaskArtifactAgent
  /** Active task memory rows looked up earlier — used to map UPDATE ids to their category for second-pass content validation. */
  existingMemories: Array<{ id: string; category: MemoryCategory }>
  /**
   * text → vector for embeddings already computed by the caller (the service
   * embeds each candidate for retrieval; reuse here so ADD doesn't re-embed).
   * Keyed by memoryContentToText(category, content). LUM-324.
   */
  precomputedEmbeddings?: ReadonlyMap<string, number[]>
}

export interface ApplyOperationsResult {
  added: number
  updated: number
  deleted: number
  superseded: number
  noop: number
  /** Operations dropped because content/category/id failed second-pass validation. */
  skipped: number
}

/**
 * Apply a Layer 1 operations batch atomically. Every ADD / UPDATE is
 * re-validated against the per-category Zod schema (`parseMemoryContent`)
 * — the LLM's output schema only checks the operation envelope, so this is
 * the gate that keeps malformed content out of the DB. UPDATE / DELETE
 * targeting an unknown id is dropped (the row may have been deleted
 * concurrently).
 *
 * The transaction is all-or-nothing: a single bad row would otherwise be
 * isolated by the per-op skip path, so the transaction only fails if Prisma
 * itself errors.
 *
 * Embedding stamping (LUM-324): for ADD / UPDATE / SUPERSEDE a best-effort
 * pgvector embedding is stamped after the content write. The embed call is
 * issued OUTSIDE the transaction so a gateway failure never aborts the write.
 */
export async function applyLayer1Operations(
  input: ApplyOperationsInput
): Promise<ApplyOperationsResult> {
  const result: ApplyOperationsResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    superseded: 0,
    noop: 0,
    skipped: 0,
  }

  // Pre-validate operations *outside* the transaction so we don't open one for
  // a batch that's entirely NOOP / invalid. Each op is reduced to a callable
  // that runs against the tx client.
  const knownCategoryById = new Map(
    input.existingMemories.map(m => [m.id, m.category])
  )

  // A-MEM reuse guardrail (LUM-325): resolve which SUPERSEDE targets are
  // high-trust (usage signal) up front, in one batched lineage lookup outside
  // the transaction. Guarded targets keep their existing ACTIVE row.
  const guardedSupersedeIds = await resolveGuardedSupersedeIds(
    input.operations.filter(op => op.type === 'SUPERSEDE').map(op => op.id)
  )

  // Phase 1: validate each op and collect resolved entries for embedding.
  // For ADD/UPDATE/SUPERSEDE we capture the text and a plan-builder.
  type Plan = (tx: Prisma.TransactionClient) => Promise<void>

  interface ResolvedWriteOp {
    text: string
    buildPlan: (vector: number[] | undefined) => Plan
  }

  const resolvedWrites: ResolvedWriteOp[] = []
  const deletePlans: Plan[] = []

  for (const op of input.operations) {
    if (op.type === 'NOOP') {
      result.noop++
      continue
    }
    if (op.type === 'DELETE') {
      if (!knownCategoryById.has(op.id)) {
        result.skipped++
        continue
      }
      deletePlans.push(async tx => {
        await memoryRepository.delete(op.id, tx)
        result.deleted++
      })
      continue
    }
    if (op.type === 'SUPERSEDE') {
      if (guardedSupersedeIds.has(op.id)) {
        logger.info(
          `[memory.layer1] guarded SUPERSEDE id=${op.id} — high-trust (usage) memory left active`
        )
        result.skipped++
        continue
      }
      const existingCategory = knownCategoryById.get(op.id)
      if (!existingCategory) {
        result.skipped++
        continue
      }
      let validated: unknown
      try {
        validated = parseMemoryContent(existingCategory, op.content)
      } catch (error) {
        logger.warn(
          `[memory.layer1] dropped SUPERSEDE id=${op.id} (content failed ${existingCategory} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      const id = op.id
      const text = memoryContentToText(existingCategory, validated)
      resolvedWrites.push({
        text,
        buildPlan: vector => async tx => {
          // Option B: new ACTIVE row carries the new content; embedding belongs
          // on that new row, not the superseded original.
          const { newId } = await memoryRepository.supersede(
            id,
            validated as Prisma.InputJsonValue,
            tx,
            scanMemoryContent(existingCategory, validated)
          )
          result.superseded++
          if (vector !== undefined) {
            await memoryRepository.setEmbedding(newId, vector, tx)
          }
        },
      })
      continue
    }
    if (op.type === 'ADD') {
      let validated: unknown
      try {
        validated = parseMemoryContent(op.category, op.content)
      } catch (error) {
        logger.warn(
          `[memory.layer1] dropped ADD (content failed ${op.category} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      const category = op.category
      // PROJECT-scope memories MUST have taskId=null so they aren't double-
      // counted under the source task's view (they're surfaced via the
      // project-scope path on every task in the project). LLM omits scope
      // → fall back to TASK to keep pre-scope outputs working.
      const scope = op.scope ?? 'TASK'
      const taskId = scope === 'PROJECT' ? null : input.taskId
      const text = memoryContentToText(category, validated)
      resolvedWrites.push({
        text,
        buildPlan: vector => async tx => {
          const created = await memoryRepository.create(
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              taskId,
              scope,
              category,
              content: validated as Prisma.InputJsonValue,
              sourceSessionId: input.sessionId,
              createdByMemberId: null,
              // Birth-task accounting (LUM-397): recorded for BOTH scopes —
              // PROJECT rows null taskId above, which is exactly the reverse
              // lookup this column restores.
              sourceTaskId: input.taskId,
              ...(input.agent !== undefined ? { agent: input.agent } : {}),
              contentSignals: scanMemoryContent(category, validated),
            },
            tx
          )
          result.added++
          if (vector !== undefined) {
            await memoryRepository.setEmbedding(created.id, vector, tx)
          }
        },
      })
      continue
    }
    // UPDATE
    const existingCategory = knownCategoryById.get(op.id)
    if (!existingCategory) {
      result.skipped++
      continue
    }
    let validated: unknown
    try {
      validated = parseMemoryContent(existingCategory, op.content)
    } catch (error) {
      logger.warn(
        `[memory.layer1] dropped UPDATE id=${op.id} (content failed ${existingCategory} schema):`,
        error instanceof Error ? error.message : error
      )
      result.skipped++
      continue
    }
    const id = op.id
    const text = memoryContentToText(existingCategory, validated)
    resolvedWrites.push({
      text,
      buildPlan: vector => async tx => {
        await memoryRepository.updateContent(
          id,
          validated as Prisma.InputJsonValue,
          tx,
          scanMemoryContent(existingCategory, validated)
        )
        result.updated++
        if (vector !== undefined) {
          await memoryRepository.setEmbedding(id, vector, tx)
        }
      },
    })
  }

  if (resolvedWrites.length === 0 && deletePlans.length === 0) return result

  // Phase 2: batch-embed texts not already in precomputedEmbeddings.
  // This happens OUTSIDE the DB transaction so a gateway failure never aborts
  // the content write (best-effort).
  const vectorByText = new Map<string, number[]>(
    input.precomputedEmbeddings ?? []
  )
  const missingTexts = resolvedWrites
    .map(r => r.text)
    .filter(t => t.length > 0 && !vectorByText.has(t))
  const uniqueMissingTexts = [...new Set(missingTexts)]

  if (uniqueMissingTexts.length > 0) {
    try {
      const vectors = await embedTexts(uniqueMissingTexts)
      uniqueMissingTexts.forEach((t, i) => {
        const v = vectors[i]
        if (v !== undefined) vectorByText.set(t, v)
      })
    } catch (err) {
      logger.warn(
        '[memory.layer1] embedTexts failed — skipping embedding for this batch:',
        err instanceof Error ? err.message : err
      )
      // vectorByText stays as-is (only precomputed ones if any); all misses
      // will get undefined vectors → setEmbedding not called → content still writes.
    }
  }

  // Phase 3: build final plans with the resolved vectors.
  const plans: Plan[] = [
    ...resolvedWrites.map(r => {
      const vector = r.text.length > 0 ? vectorByText.get(r.text) : undefined
      return r.buildPlan(vector)
    }),
    ...deletePlans,
  ]

  await memoryRepository.applyPlansAtomically(plans)

  return result
}
