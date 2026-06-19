import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { MemoryCategory } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryContentToText } from '@/lib/memory/content-text'
import { parseMemoryContent, type MemoryContent } from '@/lib/memory/schemas'
import {
  coverageOutputSchema,
  foldClustersOutputSchema,
  type CoverageVerdict,
  type FoldProposal,
} from '@/lib/memory/fold-schemas'
import { logger } from '@/lib/logger'

const MODEL_ID = 'deepseek/deepseek-v4-flash'

/** A cluster must have at least this many covered cards to be worth folding
 *  (≤2 overlaps the P5 near-dup merge territory; folding is for "many fine"). */
export const MIN_CLUSTER_SIZE = 3
/** Coverage quote must be at least this long to count (guards empty/degenerate). */
const MIN_QUOTE_LEN = 8

const CATEGORIES: MemoryCategory[] = [
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
]

interface FoldItem {
  id: string
  text: string
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The fail-closed coverage gate (pure). A source is covered ONLY if the judge
 * said covered=true AND produced an evidence quote that is actually a substring
 * of the coarse card (normalized). Missing verdict, covered=false, empty/short
 * quote, or a quote absent from the coarse card all → NOT covered. The returned
 * list is exactly the set that may be superseded.
 */
export function selectCoveredSources(
  coarseText: string,
  sources: FoldItem[],
  verdicts: CoverageVerdict[]
): string[] {
  const haystack = norm(coarseText)
  const byId = new Map(verdicts.map(v => [v.sourceMemoryId, v]))
  const covered: string[] = []
  for (const s of sources) {
    const v = byId.get(s.id)
    if (!v || v.covered !== true) continue
    const q = norm(v.evidenceQuote ?? '')
    if (q.length < MIN_QUOTE_LEN) continue
    if (!haystack.includes(q)) continue
    covered.push(s.id)
  }
  return covered
}

/** LLM: cluster related-but-not-duplicate cards of one category into subsystem
 *  groups and synthesize a coarse card per group. Returns [] on any error. */
async function clusterAndSynthesize(
  category: MemoryCategory,
  items: FoldItem[]
): Promise<Array<{ sourceMemoryIds: string[]; coarseContent: unknown }>> {
  const system =
    `You consolidate a software team's ${category} memory cards. Group cards that ` +
    `concern the SAME subsystem/theme but are NOT duplicates (e.g. several Prisma/` +
    `migration gotchas, several jest/test gotchas) into clusters of 3 or more. For ` +
    `each cluster, synthesize ONE coarse "subsystem card" whose content preserves ` +
    `EVERY member card's key invariant/gotcha — losing a detail is failure. Output ` +
    `the coarse card as a ${category} content object (same fields as the inputs). ` +
    `Do not cluster unrelated themes together. Leave a card unclustered if it has ` +
    `no 2+ same-subsystem siblings.`
  const user = JSON.stringify({
    category,
    cards: items.map(i => ({ id: i.id, text: i.text })),
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: foldClustersOutputSchema,
      system,
      prompt: user,
    })
    return object.clusters
  } catch (error) {
    logger.warn(
      `[memory.fold] cluster/synthesize failed category=${category}:`,
      error instanceof Error ? error.message : error
    )
    return []
  }
}

/** LLM: per source, is its actionable detail present in the coarse card? Must
 *  quote the covering passage verbatim from the coarse card. [] on any error. */
async function coverageVerdicts(
  coarseText: string,
  sources: FoldItem[]
): Promise<CoverageVerdict[]> {
  const system =
    `Decide, for each source card, whether the COARSE card already contains that ` +
    `source's actionable detail (the specific trigger/workaround/rule a reader would ` +
    `act on). If yes, set covered=true and copy the exact covering passage from the ` +
    `COARSE card into evidenceQuote (verbatim substring). If not fully covered, set ` +
    `covered=false. When unsure, answer covered=false.`
  const user = JSON.stringify({
    coarseCard: coarseText,
    sources: sources.map(s => ({ sourceMemoryId: s.id, text: s.text })),
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: coverageOutputSchema,
      system,
      prompt: user,
    })
    return object.verdicts
  } catch (error) {
    logger.warn(
      `[memory.fold] coverage judge failed:`,
      error instanceof Error ? error.message : error
    )
    return []
  }
}

/**
 * Compute fold proposals for a project's ACTIVE PROJECT memories. Reads only —
 * no writes. Buckets by category; per bucket the LLM clusters + synthesizes; the
 * fail-closed coverage gate decides which sources are safe to fold. A proposal
 * is emitted only when ≥ MIN_CLUSTER_SIZE sources pass the gate. Best-effort:
 * every LLM step degrades to "no fold" (empty), never throws on model failure.
 */
export async function computeProjectFoldProposals(
  projectId: string
): Promise<FoldProposal[]> {
  const memories = await memoryRepository.findActiveProjectMemories(projectId)
  const proposals: FoldProposal[] = []

  for (const category of CATEGORIES) {
    const items: FoldItem[] = memories
      .filter(m => m.category === category)
      .map(m => ({ id: m.id, text: memoryContentToText(category, m.content) }))
    if (items.length < MIN_CLUSTER_SIZE) continue

    const clusters = await clusterAndSynthesize(category, items)
    const itemById = new Map(items.map(i => [i.id, i]))

    for (const cluster of clusters) {
      if (cluster.sourceMemoryIds.length < MIN_CLUSTER_SIZE) continue

      // Validate the coarse content shape (fail-closed: invalid → skip cluster).
      let coarseContent: MemoryContent
      try {
        coarseContent = parseMemoryContent(category, cluster.coarseContent)
      } catch {
        continue
      }

      const clusterSources = cluster.sourceMemoryIds
        .map(id => itemById.get(id))
        .filter((i): i is FoldItem => i !== undefined)
      const coarseText = memoryContentToText(category, coarseContent)

      const verdicts = await coverageVerdicts(coarseText, clusterSources)
      const sourceIds = selectCoveredSources(
        coarseText,
        clusterSources,
        verdicts
      )
      if (sourceIds.length < MIN_CLUSTER_SIZE) continue

      const excludedIds = cluster.sourceMemoryIds.filter(
        id => !sourceIds.includes(id)
      )
      proposals.push({ category, coarseContent, sourceIds, excludedIds })
    }
  }

  return proposals
}
