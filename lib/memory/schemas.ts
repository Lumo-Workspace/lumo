import { z } from 'zod'
import type { MemoryCategory } from '@prisma/client'

export const trapContentSchema = z.object({
  trigger: z.string().min(1),
  outcome: z.string().min(1),
  workaround: z.string().optional(),
})

export const decisionContentSchema = z.object({
  what: z.string().min(1),
  why: z.string().min(1),
  /** The alternative(s) considered and why they were rejected. */
  alternatives: z.string().min(1).optional(),
  /** What this decision commits us to — capabilities lost or constraints introduced. */
  implications: z.string().min(1).optional(),
})

export const conventionContentSchema = z.object({
  rule: z.string().min(1),
  scope: z.string().min(1),
})

export const proceduralContentSchema = z.object({
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
