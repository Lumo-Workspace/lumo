import { z } from 'zod'
import type { MemoryCategory } from '@prisma/client'

/**
 * Every category carries an optional one-line `summary` used as the memory
 * card *title*. It is intentionally shorter than the per-category headline
 * field (`trigger` / `what` / `rule` / `workflow`), which holds the full
 * sentence and renders as a body section when a summary is present. When
 * `summary` is absent (older rows, manual entries that skip it), the card
 * falls back to the headline field — so the field is backward compatible and
 * no data migration is required.
 */
export const trapContentSchema = z.object({
  summary: z.string().min(1).optional(),
  trigger: z.string().min(1),
  outcome: z.string().min(1),
  workaround: z.string().optional(),
})

export const decisionContentSchema = z.object({
  summary: z.string().min(1).optional(),
  what: z.string().min(1),
  why: z.string().min(1),
  /** The alternative(s) considered and why they were rejected. */
  alternatives: z.string().min(1).optional(),
  /** What this decision commits us to — capabilities lost or constraints introduced. */
  implications: z.string().min(1).optional(),
})

export const conventionContentSchema = z.object({
  summary: z.string().min(1).optional(),
  rule: z.string().min(1),
  scope: z.string().min(1),
})

export const proceduralContentSchema = z.object({
  summary: z.string().min(1).optional(),
  workflow: z.string().min(1),
  trigger: z.string().min(1),
  steps: z.array(z.string().min(1)).optional(),
})

export type TrapContent = z.infer<typeof trapContentSchema>
export type DecisionContent = z.infer<typeof decisionContentSchema>
export type ConventionContent = z.infer<typeof conventionContentSchema>
export type ProceduralContent = z.infer<typeof proceduralContentSchema>

export type MemoryContent =
  | TrapContent
  | DecisionContent
  | ConventionContent
  | ProceduralContent

export function parseMemoryContent(
  category: MemoryCategory,
  content: unknown
): MemoryContent {
  switch (category) {
    case 'TRAP':
      return trapContentSchema.parse(content)
    case 'DECISION':
      return decisionContentSchema.parse(content)
    case 'CONVENTION':
      return conventionContentSchema.parse(content)
    case 'PROCEDURAL':
      return proceduralContentSchema.parse(content)
  }
}
