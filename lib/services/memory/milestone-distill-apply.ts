import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { memoryContentToText } from '@/lib/memory/content-text'
import { loadMemoryWriteGate } from './write-gate'
import { embedTexts } from '@/lib/ai/embedding'
import type { MemoryCategory, Prisma } from '@prisma/client'
import type { MilestoneDistillCandidate } from './milestone-distill-extract'

export interface ApplyMilestoneDistillInput {
  candidates: MilestoneDistillCandidate[]
  milestoneId: string
  projectId: string
  workspaceId: string
  /**
   * Existing MILESTONE-scope memories for this milestone. Used for a
   * deterministic exact-dup guard so a summary-retry never writes a second copy
   * of a lesson already recorded (the extract prompt is also told to skip them,
   * but the guard makes idempotency independent of the LLM).
   */
  existingMilestoneMemories: Array<{
    category: MemoryCategory
    content: unknown
  }>
}

export interface ApplyMilestoneDistillResult {
  added: number
  /** Dropped: content failed its category schema, or was an exact duplicate. */
  skipped: number
}

/**
 * Write grounded milestone-distillation candidates as MILESTONE-scope memories
 * (LUM-647): scope=MILESTONE, milestoneId set, taskId null. Mirrors the Layer-2
 * apply discipline — per-row content re-validation (one malformed candidate is
 * dropped, never the batch) and best-effort pgvector embedding stamped outside
 * the write transaction so a gateway failure can't abort the content write.
 *
 * Vocabulary is ADD-only: distillation surfaces new milestone lessons; dedup is
 * a drop, not an UPDATE/SUPERSEDE (there is no authored prior version to refine).
 */
export async function applyMilestoneDistillOperations(
  input: ApplyMilestoneDistillInput
): Promise<ApplyMilestoneDistillResult> {
  const result: ApplyMilestoneDistillResult = { added: 0, skipped: 0 }

  const existingTexts = new Set(
    input.existingMilestoneMemories.map(m =>
      dupKey(m.category, safeText(m.category, m.content))
    )
  )

  type Plan = (tx: Prisma.TransactionClient) => Promise<void>
  interface ResolvedWrite {
    text: string
    buildPlan: (vector: number[] | undefined) => Plan
  }
  const resolvedWrites: ResolvedWrite[] = []
  const seenThisBatch = new Set<string>()

  // LUM-793: write-time poison gate, loaded once for the batch.
  const writeGate = await loadMemoryWriteGate(input.projectId)

  for (const candidate of input.candidates) {
    let validated: unknown
    try {
      validated = parseMemoryContent(candidate.category, candidate.content)
    } catch (error) {
      logger.warn(
        `[memory.milestone-distill] dropped candidate (content failed ${candidate.category} schema):`,
        error instanceof Error ? error.message : error
      )
      result.skipped++
      continue
    }

    const category = candidate.category
    const screened = writeGate.screen(category, validated)
    if (!screened.ok) {
      logger.warn(
        `[memory.milestone-distill] dropped candidate — ${screened.message}`
      )
      result.skipped++
      continue
    }
    const signals = screened.signals
    const text = memoryContentToText(category, validated)
    const key = dupKey(category, text)
    if (existingTexts.has(key) || seenThisBatch.has(key)) {
      result.skipped++
      continue
    }
    seenThisBatch.add(key)

    resolvedWrites.push({
      text,
      buildPlan: vector => async tx => {
        const created = await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: null,
            milestoneId: input.milestoneId,
            scope: 'MILESTONE',
            category,
            content: validated as Prisma.InputJsonValue,
            sourceSessionId: null,
            createdByMemberId: null,
            contentSignals: signals,
          },
          tx
        )
        result.added++
        if (vector !== undefined) {
          await memoryRepository.setEmbedding(created.id, vector, tx)
        }
      },
    })
  }

  if (resolvedWrites.length === 0) return result

  // Best-effort embedding OUTSIDE the transaction (gateway failure must not
  // abort the content write) — mirrors layer2-apply.
  const vectorByText = new Map<string, number[]>()
  const uniqueTexts = [
    ...new Set(resolvedWrites.map(r => r.text).filter(t => t.length > 0)),
  ]
  if (uniqueTexts.length > 0) {
    try {
      const vectors = await embedTexts(uniqueTexts)
      uniqueTexts.forEach((t, i) => {
        const v = vectors[i]
        if (v !== undefined) vectorByText.set(t, v)
      })
    } catch (err) {
      logger.warn(
        '[memory.milestone-distill] embedTexts failed — writing without embeddings:',
        err instanceof Error ? err.message : err
      )
    }
  }

  const plans: Plan[] = resolvedWrites.map(r =>
    r.buildPlan(r.text.length > 0 ? vectorByText.get(r.text) : undefined)
  )
  await memoryRepository.applyPlansAtomically(plans)

  return result
}

function dupKey(category: MemoryCategory, text: string): string {
  return `${category}::${text.trim().toLowerCase()}`
}

function safeText(category: MemoryCategory, content: unknown): string {
  try {
    return memoryContentToText(category, parseMemoryContent(category, content))
  } catch {
    return JSON.stringify(content)
  }
}
