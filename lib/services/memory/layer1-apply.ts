import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { parseMemoryContent } from '@/lib/memory/schemas'
import type { MemoryCategory, Prisma } from '@prisma/client'
import type { Layer1Operation } from './layer1-extract'

interface ApplyOperationsInput {
  operations: Layer1Operation[]
  taskId: string
  projectId: string
  workspaceId: string
  sessionId: string
  /** Active task memory rows looked up earlier — used to map UPDATE ids to their category for second-pass content validation. */
  existingMemories: Array<{ id: string; category: MemoryCategory }>
}

export interface ApplyOperationsResult {
  added: number
  updated: number
  deleted: number
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
 */
export async function applyLayer1Operations(
  input: ApplyOperationsInput
): Promise<ApplyOperationsResult> {
  const result: ApplyOperationsResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    noop: 0,
    skipped: 0,
  }

  // Pre-validate operations *outside* the transaction so we don't open one for
  // a batch that's entirely NOOP / invalid. Each op is reduced to a callable
  // that runs against the tx client.
  const knownCategoryById = new Map(
    input.existingMemories.map(m => [m.id, m.category])
  )
  type Plan = (tx: Prisma.TransactionClient) => Promise<void>
  const plans: Plan[] = []

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
      plans.push(async tx => {
        await memoryRepository.delete(op.id, tx)
        result.deleted++
      })
      continue
    }
    if (op.type === 'ADD') {
      let validated: unknown
      try {
        validated = parseMemoryContent(op.category, op.content)
      } catch (error) {
        console.warn(
          `[memory.layer1] dropped ADD (content failed ${op.category} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      const category = op.category
      plans.push(async tx => {
        await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: input.taskId,
            scope: 'TASK',
            category,
            content: validated as Prisma.InputJsonValue,
            sourceSessionId: input.sessionId,
          },
          tx
        )
        result.added++
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
      console.warn(
        `[memory.layer1] dropped UPDATE id=${op.id} (content failed ${existingCategory} schema):`,
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

  await prisma.$transaction(async tx => {
    for (const plan of plans) await plan(tx)
  })

  return result
}
