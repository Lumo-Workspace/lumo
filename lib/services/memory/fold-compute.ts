import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { MemoryCategory } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryContentToText } from '@/lib/memory/content-text'
import { parseMemoryContent, type MemoryContent } from '@/lib/memory/schemas'
import {
  coarseCardSchemaFor,
  coverageOutputSchema,
  foldClusterGroupsSchema,
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

/** The exact structured fields the coarse card must use per category — so the
 *  model fills the per-category content shape instead of a free `{id,text}` blob
 *  (which the shape guard would reject, folding nothing — LUM-553 dogfood). A
 *  coarse card legitimately holds multi-point detail; enumerate `(1)… (2)…`
 *  WITHIN a field rather than reaching for an unstructured field. */
const FIELD_GUIDE: Record<MemoryCategory, string> = {
  TRAP:
    'Use ONLY: summary (the subsystem/theme name, e.g. "Prisma migrations"), ' +
    'trigger (when these gotchas bite — consolidate every member), outcome ' +
    '(what breaks), workaround (the consolidated fixes; enumerate "(1)… (2)…"). ' +
    "Preserve every member trap's specific trigger and fix.",
  DECISION:
    'Use ONLY: summary (the area), what (the consolidated decisions; enumerate), ' +
    'why (the reasons), alternatives (rejected options), implications (consequences).',
  CONVENTION:
    'Use ONLY: summary (the area), rule (the consolidated rules; enumerate ' +
    '"(1)… (2)…"), scope (where they apply).',
  PROCEDURAL:
    'Use ONLY: summary (the workflow area), workflow (the consolidated procedure), ' +
    'trigger (when to run it), steps (array of concrete steps across the members).',
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Flash models intermittently return JSON that fails strict schema validation
 *  ("No object generated: response did not match schema"). Retry a few times —
 *  the next sample usually conforms — before giving up (best-effort → fallback). */
async function generateWithRetry<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        logger.warn(
          `[memory.fold] ${label} failed after ${MAX_ATTEMPTS} attempts:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  }
  return null
}

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

/** Phase 1 — LLM: group one category's cards into subsystem clusters (ids only,
 *  no synthesis). Returns the id groups, or [] on any error. Tiny output, so a
 *  large category can't truncate the grouping. */
async function clusterMemories(
  category: MemoryCategory,
  items: FoldItem[]
): Promise<string[][]> {
  const system =
    `You consolidate a software team's ${category} memory cards. Group cards that ` +
    `concern the SAME subsystem/theme but are NOT duplicates (e.g. several Prisma/` +
    `migration gotchas, several jest/test gotchas) into clusters of 3 or more. ` +
    `Return ONLY the id groupings — do not write any card content. Do not cluster ` +
    `unrelated themes together. Leave a card unclustered if it has no 2+ ` +
    `same-subsystem siblings.`
  const user = JSON.stringify({
    category,
    cards: items.map(i => ({ id: i.id, text: i.text })),
  })
  const res = await generateWithRetry(`clustering category=${category}`, () =>
    generateObject({
      model: gateway(MODEL_ID),
      schema: foldClusterGroupsSchema,
      system,
      prompt: user,
    })
  )
  return res ? res.object.clusters.map(c => c.sourceMemoryIds) : []
}

/** Phase 2 — LLM: synthesize ONE coarse "subsystem card" for ONE cluster,
 *  preserving every member's invariant/gotcha in the category's structured
 *  fields. Returns null on any error (so one bad cluster drops only itself). */
async function synthesizeCoarse(
  category: MemoryCategory,
  members: FoldItem[]
): Promise<MemoryContent | null> {
  const system =
    `You consolidate a software team's ${category} memory cards into ONE coarse ` +
    `"subsystem card" whose content preserves EVERY member card's key invariant/` +
    `gotcha — losing a detail is failure. ${FIELD_GUIDE[category]} Do NOT add an id ` +
    `or a free "text"/"content" field — populate ONLY the named fields above.`
  const user = JSON.stringify({
    category,
    cards: members.map(m => m.text),
  })
  const res = await generateWithRetry(`synthesis category=${category}`, () =>
    generateObject({
      model: gateway(MODEL_ID),
      schema: coarseCardSchemaFor(category),
      system,
      prompt: user,
    })
  )
  return res ? (res.object as MemoryContent) : null
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
  const res = await generateWithRetry('coverage judge', () =>
    generateObject({
      model: gateway(MODEL_ID),
      schema: coverageOutputSchema,
      system,
      prompt: user,
    })
  )
  return res ? res.object.verdicts : []
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

    const groups = await clusterMemories(category, items)
    const itemById = new Map(items.map(i => [i.id, i]))

    for (const group of groups) {
      // Resolve to real bucket members (drop any id the LLM hallucinated).
      const clusterSources = group
        .map(id => itemById.get(id))
        .filter((i): i is FoldItem => i !== undefined)
      if (clusterSources.length < MIN_CLUSTER_SIZE) continue

      // Phase 2 — synthesize this cluster's coarse card; skip on failure.
      const synthesized = await synthesizeCoarse(category, clusterSources)
      if (!synthesized) continue
      // Re-validate the shape (defense in depth; the schema already enforced it).
      let coarseContent: MemoryContent
      try {
        coarseContent = parseMemoryContent(category, synthesized)
      } catch {
        continue
      }
      const coarseText = memoryContentToText(category, coarseContent)

      const verdicts = await coverageVerdicts(coarseText, clusterSources)
      const sourceIds = selectCoveredSources(
        coarseText,
        clusterSources,
        verdicts
      )
      if (sourceIds.length < MIN_CLUSTER_SIZE) continue

      const excludedIds = clusterSources
        .map(s => s.id)
        .filter(id => !sourceIds.includes(id))
      proposals.push({ category, coarseContent, sourceIds, excludedIds })
    }
  }

  return proposals
}
