import { z } from 'zod'
import type { MemoryCategory } from '@prisma/client'
import {
  conventionContentSchema,
  decisionContentSchema,
  proceduralContentSchema,
  trapContentSchema,
  type MemoryContent,
} from '@/lib/memory/schemas'

/**
 * LUM-553 — topic folding. Two LLM outputs:
 *  1. cluster + synthesize: group related-but-not-duplicate cards of ONE
 *     category into subsystem clusters, each with a synthesized coarse card.
 *  2. coverage: per source card, does the coarse card contain its actionable
 *     detail? Quote the covering passage (quote-or-discard, fail-closed).
 */

const contentSchemaByCategory = {
  TRAP: trapContentSchema,
  DECISION: decisionContentSchema,
  CONVENTION: conventionContentSchema,
  PROCEDURAL: proceduralContentSchema,
} as const

/**
 * Phase 1 — clustering ONLY (no synthesis). Returns the subsystem groupings as
 * id sets. Kept separate from synthesis so a large category's clustering (just
 * id groups, tiny output) can't be lost to truncation, and so each coarse card
 * is synthesized in its OWN call — one malformed/oversized card drops only that
 * cluster, never the whole category (the LUM-553 dogfood failure mode: a single
 * all-or-nothing call over 122 TRAP cards returned zero).
 */
export const foldClusterGroupsSchema = z.object({
  clusters: z.array(
    z.object({ sourceMemoryIds: z.array(z.string().min(1)).min(2) })
  ),
})

/**
 * Phase 2 — the schema for ONE synthesized coarse card: the category's
 * structured content shape directly (no wrapper — flatter is easier for the
 * model to satisfy). Forcing this shape means the model cannot emit a free
 * `{id, text}` summary blob, which `parseMemoryContent` would reject downstream,
 * folding nothing (the LUM-553 dogfood failure).
 */
export function coarseCardSchemaFor(category: MemoryCategory) {
  return contentSchemaByCategory[category]
}

/** Per-source coverage verdict from the gate judge. */
export const coverageVerdictSchema = z.object({
  sourceMemoryId: z.string().min(1),
  covered: z.boolean(),
  /** A passage copied verbatim from the coarse card that covers this source. */
  evidenceQuote: z.string(),
})
export const coverageOutputSchema = z.object({
  verdicts: z.array(coverageVerdictSchema),
})

export type CoverageVerdict = z.infer<typeof coverageVerdictSchema>

/** The unit the fold pass acts on. `sourceIds` = coverage-passed (will be
 *  superseded); `excludedIds` = in the cluster but gated out (stay ACTIVE). */
export interface FoldProposal {
  category: MemoryCategory
  coarseContent: MemoryContent
  sourceIds: string[]
  excludedIds: string[]
}
