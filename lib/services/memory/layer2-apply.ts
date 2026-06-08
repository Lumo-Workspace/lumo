import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { parseMemoryContent } from '@/lib/memory/schemas'
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
   * the promoted PROJECT memory to the session that produced it (LUM-165).
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
  type Plan = (tx: Prisma.TransactionClient) => Promise<void>
  const plans: Plan[] = []

  for (const op of input.operations) {
    if (op.type === 'NOOP') {
      result.noop++
      continue
    }
    if (op.type === 'SUPERSEDE') {
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
      plans.push(async tx => {
        await memoryRepository.supersedeInPlace(
          op.id,
          validated as Prisma.InputJsonValue,
          tx
        )
        result.superseded++
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
      plans.push(async tx => {
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
    plans.push(async tx => {
      await memoryRepository.updateContent(
        op.id,
        validated as Prisma.InputJsonValue,
        tx
      )
      result.updated++
    })
  }

  if (plans.length === 0) return result

  await memoryRepository.applyPlansAtomically(plans)

  return result
}
