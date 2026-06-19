import { z } from 'zod'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'

/**
 * LUM-553 — topic folding. Two LLM outputs:
 *  1. cluster + synthesize: group related-but-not-duplicate cards of ONE
 *     category into subsystem clusters, each with a synthesized coarse card.
 *  2. coverage: per source card, does the coarse card contain its actionable
 *     detail? Quote the covering passage (quote-or-discard, fail-closed).
 */

/** One synthesized cluster. `coarseContent` is validated downstream against the
 *  per-category content schema (fail-closed: invalid shape → cluster dropped). */
export const foldClusterSchema = z.object({
  sourceMemoryIds: z.array(z.string().min(1)).min(2),
  coarseContent: z.unknown(),
})
export const foldClustersOutputSchema = z.object({
  clusters: z.array(foldClusterSchema),
})

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
