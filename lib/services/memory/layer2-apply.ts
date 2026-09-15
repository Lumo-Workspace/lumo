import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { scanMemoryContent } from '@/lib/services/content-signals'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { resolveGuardedSupersedeIds } from './supersede-guard'
import type { MemoryCategory, Prisma } from '@prisma/client'
import type { Layer2Operation } from './layer2-extract'

interface ApplyOperationsInput {
  operations: Layer2Operation[]
  projectId: string
  workspaceId: string
  /**
   * Existing PROJECT-scope memories looked up earlier — used to map UPDATE
   * ids to their category for second-pass content validation. Layer 2 only
   * touches PROJECT-scope rows, so this list does not include TASK-scope.
   */
  existingProjectMemories: Array<{ id: string; category: MemoryCategory }>
  /**
   * Claude Code session that triggered this consolidation (task→done from
   * the CLI). Stamped onto every ADD so the next session-start can attribute
   * the consolidated PROJECT memory to the session that produced it (LUM-165).
   * Null/undefined for non-CLI triggers (Web UI mark-done) — those rows stay
   * unattributable, which is acceptable since there's no session to review.
   */
  sourceSessionId?: string | null | undefined
  /**
   * Ids of the TASK memories that fed this consolidation (the input window).
   * LUM-280: an ADD's `sourceMemoryIds` are intersected with this set before
   * provenance is written, so a hallucinated id can never create a dangling
   * provenance edge. Omitted/empty → no provenance is written for any ADD.
   */
  validSourceMemoryIds?: string[]
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
  superseded: number
  noop: number
  /** Operations dropped because content/category/id failed second-pass validation. */
  skipped: number
}

/**
 * Apply a Layer 2 operations batch atomically. Mirrors the Layer 1 apply
 * pipeline but with a tighter vocabulary:
 *
 *   - ADD always writes scope=PROJECT, taskId=null. sourceSessionId is the
 *     triggering CC session when task→done came from the CLI (LUM-165), else
 *     null. The row is the product of consolidation, not a session sediment.
 *   - UPDATE refines an existing PROJECT-scope memory in place; the new
 *     content must validate against the existing row's category.
 *   - There is no DELETE — consolidation only promotes / refines.
 *
 * Like Layer 1, every ADD / UPDATE is re-validated through
 * `parseMemoryContent` so a single malformed op is dropped per-row instead
 * of failing the whole batch.
 *
 * Embedding stamping (LUM-324): for ADD / UPDATE / SUPERSEDE a best-effort
 * pgvector embedding is stamped after the content write. The embed call is
 * issued OUTSIDE the transaction so a gateway failure never aborts the write.
 */
export async function applyLayer2Operations(
  input: ApplyOperationsInput
): Promise<ApplyOperationsResult> {
  const result: ApplyOperationsResult = {
    added: 0,
    updated: 0,
    superseded: 0,
    noop: 0,
    skipped: 0,
  }

  const knownCategoryById = new Map(
    input.existingProjectMemories.map(m => [m.id, m.category])
  )
  const validSourceIds = new Set(input.validSourceMemoryIds ?? [])

  // A-MEM reuse guardrail (LUM-325): high-trust (usage) SUPERSEDE targets are
  // resolved up front in one batched lineage lookup and left ACTIVE.
  const guardedSupersedeIds = await resolveGuardedSupersedeIds(
    input.operations.filter(op => op.type === 'SUPERSEDE').map(op => op.id)
  )

  // Phase 1: validate each op and collect resolved entries for embedding.
  type Plan = (tx: Prisma.TransactionClient) => Promise<void>

  interface ResolvedWriteOp {
    text: string
    buildPlan: (vector: number[] | undefined) => Plan
  }

  const resolvedWrites: ResolvedWriteOp[] = []

  for (const op of input.operations) {
    if (op.type === 'NOOP') {
      result.noop++
      continue
    }
    if (op.type === 'SUPERSEDE') {
      if (guardedSupersedeIds.has(op.id)) {
        logger.info(
          `[memory.layer2] guarded SUPERSEDE id=${op.id} — high-trust (usage) memory left active`
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
          `[memory.layer2] dropped SUPERSEDE id=${op.id} (content failed ${existingCategory} schema):`,
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
          `[memory.layer2] dropped ADD (content failed ${op.category} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      const category = op.category
      const citedSourceIds = (op.sourceMemoryIds ?? []).filter(id =>
        validSourceIds.has(id)
      )
      const text = memoryContentToText(category, validated)
      resolvedWrites.push({
        text,
        buildPlan: vector => async tx => {
          const created = await memoryRepository.create(
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              taskId: null,
              scope: 'PROJECT',
              category,
              content: validated as Prisma.InputJsonValue,
              sourceSessionId: input.sourceSessionId ?? null,
              createdByMemberId: null,
              contentSignals: scanMemoryContent(category, validated),
            },
            tx
          )
          result.added++
          if (citedSourceIds.length > 0) {
            await memoryProvenanceRepository.createMany(
              created.id,
              citedSourceIds,
              tx
            )
          }
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
        `[memory.layer2] dropped UPDATE id=${op.id} (content failed ${existingCategory} schema):`,
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

  if (resolvedWrites.length === 0) return result

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
        '[memory.layer2] embedTexts failed — skipping embedding for this batch:',
        err instanceof Error ? err.message : err
      )
      // vectorByText stays as-is (only precomputed ones if any); all misses
      // will get undefined vectors → setEmbedding not called → content still writes.
    }
  }

  // Phase 3: build final plans with the resolved vectors.
  const plans: Plan[] = resolvedWrites.map(r => {
    const vector = r.text.length > 0 ? vectorByText.get(r.text) : undefined
    return r.buildPlan(vector)
  })

  await memoryRepository.applyPlansAtomically(plans)

  return result
}
