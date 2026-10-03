import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
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
import { nearDupClusters, type VecItem } from '@/lib/services/memory/near-dup'
import { logger } from '@/lib/logger'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'

const MODEL_ID = MEMORY_JUDGE_MODEL

/** A cluster must have at least this many covered cards to be worth folding
 *  (≤2 overlaps the P5 near-dup merge territory; folding is for "many fine"). */
export const MIN_CLUSTER_SIZE = 3
/** Upper bound on a fold cluster's source count. The clustering LLM (a mid-tier
 *  deepseek model) intermittently lumps a whole category into one cluster — prod
 *  dogfood folded 24 unrelated CONVENTIONs into a single 3.5K-char mega-card
 *  (LUM-556). A coarse "subsystem card" should hold a handful of related
 *  lessons, not a category dump; an oversized LLM cluster is split (when its
 *  members are embedded) or dropped (when they're not) — never folded whole. */
export const MAX_CLUSTER_SIZE = 12
/** Cosine floor for "same subsystem, not a duplicate" — the coherence an LLM
 *  cluster's members must share to fold together. Below NEAR_DUP_MERGE_FLOOR
 *  (0.85, near-DUPLICATE) since fold targets related-not-identical cards.
 *  Calibrated on prod (scripts/fold-floor-probe.ts sweeps nearDupClusters per
 *  category): the live 42-card TRAP set merges into ONE 22-card grab-bag at 0.60
 *  (LUM-556 initial — boundary + jest + eval traps all fused), first separates
 *  into 3 coherent subsystem clusters [7,6,3] at 0.64, and collapses to almost
 *  no folds by 0.70. 0.64 is that separation knee — coherent subsystems still
 *  fold, the cross-concern grab-bag does not. Re-probe if the corpus shifts. */
export const FOLD_COHERENCE_FLOOR = 0.64
/** Coverage quote must be at least this long to count (guards empty/degenerate). */
const MIN_QUOTE_LEN = 8
/** Max concurrent per-cluster LLM pipelines. Clusters are independent, so they
 *  run in parallel — sequential processing of ~26 clusters (synthesize +
 *  coverage each) ran for minutes and blew the serverless function timeout
 *  (LUM-553 prod dogfood: a 266-card project took >300s). Capped to stay within
 *  gateway rate limits. */
const FOLD_CONCURRENCY = 6

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

/** Map `items` through `fn` with at most `limit` running concurrently, preserving
 *  input order in the result. A fixed worker pool pulls from a shared cursor. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  const poolSize = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: poolSize }, () => worker()))
  return results
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
 *  no synthesis). Returns the id groups, or **null** when the LLM step errored
 *  (retries exhausted) — distinct from `[]` (the model ran and found nothing to
 *  cluster). The caller folds null into the `degraded` signal so a gateway
 *  outage can't masquerade as "nothing to fold" (LUM-555). Tiny output, so a
 *  large category can't truncate the grouping. */
async function clusterMemories(
  category: MemoryCategory,
  items: FoldItem[]
): Promise<string[][] | null> {
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
  return res ? res.object.clusters.map(c => c.sourceMemoryIds) : null
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
    `or a free "text"/"content" field — populate ONLY the named fields above.\n\n` +
    DERIVED_CONTENT_NO_CODE_RULE
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
 * Discipline ONE LLM-proposed cluster into coherent, size-bounded sub-clusters
 * (pure). The clustering model occasionally lumps unrelated themes (or a
 * whole category) into one group; this is the guard that keeps a coarse card a
 * real "subsystem card" rather than a category dump (LUM-556).
 *
 * - **All members embedded** → split into coherence-connected components (cosine
 *   ≥ `floor`, via the shared {@link nearDupClusters}); each component is then
 *   hard-capped to `maxSize` (a larger coherent component is chunked — its
 *   members are transitively similar, so any chunk stays on-theme). Components/
 *   chunks below `minSize` are dropped, undoing the LLM's merge of stray cards.
 * - **Any member lacking an embedding** (cold/backfilling corpus) → coherence is
 *   unverifiable, so **fail closed**: keep a within-bounds cluster as-is (small
 *   clusters were never the over-merge risk) but DROP an oversized one — never
 *   synthesize a mega-card we couldn't validate.
 */
export function refineClusterByCoherence(
  memberIds: string[],
  vectorById: Map<string, number[]>,
  opts: { floor: number; minSize: number; maxSize: number }
): string[][] {
  const { floor, minSize, maxSize } = opts

  const vecItems: VecItem[] = []
  for (const id of memberIds) {
    const vector = vectorById.get(id)
    if (vector) vecItems.push({ id, vector })
  }

  // Fail-closed when we can't check every member's coherence (missing embeddings).
  if (vecItems.length < memberIds.length) {
    if (memberIds.length > maxSize) return []
    return memberIds.length >= minSize ? [memberIds] : []
  }

  const refined: string[][] = []
  for (const component of nearDupClusters(vecItems, floor)) {
    for (let i = 0; i < component.length; i += maxSize) {
      const chunk = component.slice(i, i + maxSize)
      if (chunk.length >= minSize) refined.push(chunk)
    }
  }
  return refined
}

/**
 * Compute fold proposals for a project's ACTIVE PROJECT memories. Reads only —
 * no writes. Buckets by category; per bucket the LLM clusters + synthesizes; the
 * fail-closed coverage gate decides which sources are safe to fold. A proposal
 * is emitted only when ≥ MIN_CLUSTER_SIZE sources pass the gate. Best-effort:
 * every LLM step degrades to "no fold", never throws on model failure.
 *
 * Returns `{ proposals, degraded }`. `degraded` is true when an LLM step that
 * was expected to produce output errored (a foldable bucket's clustering call,
 * or a candidate cluster's synthesis call) — distinct from "the model ran and
 * found nothing to fold". The caller (LUM-555) must NOT let prune silently
 * archive the overflow when `degraded` is true: an empty `proposals` then means
 * "fold couldn't run", not "nothing to fold". A coverage-gate drop is NOT
 * degraded — that's the fail-closed gate doing its job.
 *
 * `opts.maxProposals` bounds the work to roughly the K biggest clusters (most
 * count-reduction first), so one run stays within the serverless time budget —
 * the LLM synthesis/coverage of all clusters of a big project runs for minutes.
 * Omit it (the offline backfill) to fold every viable cluster.
 */
export async function computeProjectFoldProposals(
  projectId: string,
  opts: { maxProposals?: number } = {}
): Promise<{ proposals: FoldProposal[]; degraded: boolean }> {
  const [memories, vectorRows] = await Promise.all([
    memoryRepository.findActiveProjectMemories(projectId),
    memoryRepository.findActiveProjectMemoryVectors(projectId),
  ])
  // Embeddings for the coherence guard — a member missing here (cold/backfilling
  // corpus) makes its cluster unverifiable and is handled fail-closed below.
  const vectorById = new Map(vectorRows.map(r => [r.id, r.vector]))

  // Phase 1 — cluster every category in parallel (each is one small LLM call).
  const buckets = CATEGORIES.map(category => ({
    category,
    items: memories
      .filter(m => m.category === category)
      .map(m => ({ id: m.id, text: memoryContentToText(category, m.content) })),
  })).filter(b => b.items.length >= MIN_CLUSTER_SIZE)

  const clustered = await Promise.all(
    buckets.map(async b => {
      const groups = await clusterMemories(b.category, b.items)
      return {
        category: b.category,
        itemById: new Map(b.items.map(i => [i.id, i])),
        // null = the clustering LLM step errored for a bucket that HAD enough
        // cards to fold → the pipeline is degraded, not legitimately empty.
        groups: groups ?? [],
        clusterFailed: groups === null,
      }
    })
  )

  // A foldable bucket we couldn't even cluster → degraded (gateway outage hits
  // this first call). Synthesis failures below OR into the same signal.
  let degraded = clustered.some(c => c.clusterFailed)

  // Flatten to one work unit per viable cluster.
  const units: Array<{ category: MemoryCategory; clusterSources: FoldItem[] }> =
    []
  for (const c of clustered) {
    for (const group of c.groups) {
      // Discipline the LLM's cluster: split an incoherent/oversized group into
      // coherent, ≤MAX_CLUSTER_SIZE sub-clusters before it can become a coarse
      // card (LUM-556). Each refined sub-cluster is one work unit.
      const refined = refineClusterByCoherence(group, vectorById, {
        floor: FOLD_COHERENCE_FLOOR,
        minSize: MIN_CLUSTER_SIZE,
        maxSize: MAX_CLUSTER_SIZE,
      })
      for (const subGroup of refined) {
        // Resolve to real bucket members (drop any id the LLM hallucinated).
        const clusterSources = subGroup
          .map(id => c.itemById.get(id))
          .filter((i): i is FoldItem => i !== undefined)
        if (clusterSources.length < MIN_CLUSTER_SIZE) continue
        units.push({ category: c.category, clusterSources })
      }
    }
  }

  // Biggest clusters first — each fold of N sources cuts the count by N-1, so
  // the largest clusters reduce the index fastest toward the cap. (Now bounded
  // by MAX_CLUSTER_SIZE, so this can no longer surface an over-merged mega-card.)
  units.sort((a, b) => b.clusterSources.length - a.clusterSources.length)

  // When bounded (cron), only synthesize a candidate window of the biggest
  // clusters — 2× the target leaves headroom for coverage-gate drops — so the
  // expensive phase stays within the serverless budget. Unbounded for backfill.
  const candidates =
    opts.maxProposals !== undefined
      ? units.slice(0, opts.maxProposals * 2)
      : units

  // Phases 2–3 — synthesize + coverage-gate each cluster, concurrency-capped.
  // One unit failing/dropping never affects another. `synthFailed` marks a unit
  // whose synthesis LLM step errored (≠ a coverage-gate drop, which is the gate
  // working) so it folds into `degraded`.
  const results = await mapWithConcurrency(
    candidates,
    FOLD_CONCURRENCY,
    async ({
      category,
      clusterSources,
    }): Promise<{ proposal: FoldProposal | null; synthFailed: boolean }> => {
      const synthesized = await synthesizeCoarse(category, clusterSources)
      if (!synthesized) return { proposal: null, synthFailed: true }
      // Re-validate the shape (defense in depth; the schema already enforced it).
      let coarseContent: MemoryContent
      try {
        coarseContent = parseMemoryContent(category, synthesized)
      } catch {
        return { proposal: null, synthFailed: false }
      }
      const coarseText = memoryContentToText(category, coarseContent)

      const verdicts = await coverageVerdicts(coarseText, clusterSources)
      const sourceIds = selectCoveredSources(
        coarseText,
        clusterSources,
        verdicts
      )
      if (sourceIds.length < MIN_CLUSTER_SIZE)
        return { proposal: null, synthFailed: false }

      const excludedIds = clusterSources
        .map(s => s.id)
        .filter(id => !sourceIds.includes(id))
      return {
        proposal: { category, coarseContent, sourceIds, excludedIds },
        synthFailed: false,
      }
    }
  )

  if (results.some(r => r.synthFailed)) degraded = true

  const all = results
    .map(r => r.proposal)
    .filter((p): p is FoldProposal => p !== null)
  const proposals =
    opts.maxProposals !== undefined ? all.slice(0, opts.maxProposals) : all
  return { proposals, degraded }
}
