import { memoryRepository } from '@/lib/repositories/memory.repository'
import { parseMemoryContent } from '@/lib/memory/schemas'
import type { MemoryCategory, Prisma } from '@prisma/client'
import type { Layer3Operation } from './layer3-extract'

interface BuildPlansInput {
  operations: Layer3Operation[]
  projectId: string
  workspaceId: string
  /** Active project-memory rows looked up earlier — used to map UPDATE ids to their category for second-pass content validation. */
  existingMemories: Array<{ id: string; category: MemoryCategory }>
}

export interface Layer3ApplyResult {
  added: number
  updated: number
  noop: number
  /** Operations dropped because content/category/id failed second-pass validation. */
  skipped: number
}

export type Layer3Plan = (tx: Prisma.TransactionClient) => Promise<void>

interface BuiltPlans {
  plans: Layer3Plan[]
  /** Counters that the plans will mutate when executed inside a transaction. */
  counters: Layer3ApplyResult
}

/**
 * Translate a Layer 3 operations list into a list of plans that each take a
 * Prisma TransactionClient. The plans are not executed here — the caller
 * runs them inside a single transaction so the project-memory write is
 * all-or-nothing.
 *
 * Each ADD / UPDATE re-validates content against the per-category Zod
 * schema. UPDATE targeting an unknown id is dropped (the row may have been
 * deleted concurrently). Project memory is intentionally append-only from
 * this layer: there is no DELETE op.
 */
export function buildLayer3Plans(input: BuildPlansInput): BuiltPlans {
  const counters: Layer3ApplyResult = {
    added: 0,
    updated: 0,
    noop: 0,
    skipped: 0,
  }
  const knownCategoryById = new Map(
    input.existingMemories.map(m => [m.id, m.category])
  )
  const plans: Layer3Plan[] = []

  for (const op of input.operations) {
    if (op.type === 'NOOP') {
      counters.noop++
      continue
    }
    if (op.type === 'ADD') {
      let validated: unknown
      try {
        validated = parseMemoryContent(op.category, op.content)
      } catch (error) {
        console.warn(
          `[memory.layer3] dropped ADD (content failed ${op.category} schema):`,
          error instanceof Error ? error.message : error
        )
        counters.skipped++
        continue
      }
      const category = op.category
      plans.push(async tx => {
        await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: null,
            scope: 'PROJECT',
            category,
            content: validated as Prisma.InputJsonValue,
            sourceSessionId: null,
          },
          tx
        )
        counters.added++
      })
      continue
    }
    // UPDATE
    const existingCategory = knownCategoryById.get(op.id)
    if (!existingCategory) {
      counters.skipped++
      continue
    }
    let validated: unknown
    try {
      validated = parseMemoryContent(existingCategory, op.content)
    } catch (error) {
      console.warn(
        `[memory.layer3] dropped UPDATE id=${op.id} (content failed ${existingCategory} schema):`,
        error instanceof Error ? error.message : error
      )
      counters.skipped++
      continue
    }
    plans.push(async tx => {
      await memoryRepository.updateContent(
        op.id,
        validated as Prisma.InputJsonValue,
        tx
      )
      counters.updated++
    })
  }

  return { plans, counters }
}
