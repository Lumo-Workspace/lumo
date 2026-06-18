import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  lineageEdgeRepository,
  type FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import { computeFragmentTrust, trustKey } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
import {
  applyTokenBudget,
  memoryHeadline,
  type RenderableMemory,
} from '@/lib/memory/render'
import { bigramSimilarity } from '@/lib/similarity'
import { rankForSync } from '@/lib/services/memory/sync-bundle'
import {
  toSyncEntry,
  type ShapedSyncBundle,
} from '@/lib/services/memory/sync-file-shape'

/** P2 routing anchor: the text the recipient's relevant memories are scored
 * against (e.g. the dev's active task titles + descriptions). */
export interface RoutingContext {
  anchorText: string
}

export interface BuildBundleOptions {
  syncedAtIso?: string
  /** When set, the bundle is routed: only memories relevant to the anchor are
   * included (per-recipient, not a full broadcast). */
  routing?: RoutingContext
}

export interface BuildBundleDeps {
  /** Pluggable relevance scorer (memoryText, anchorText) → 0..1. Defaults to
   * lexical {@link bigramSimilarity}; an embedding-backed scorer can be injected
   * later without touching the selector. */
  relevanceScore?: (memoryText: string, anchorText: string) => number
}

/** Routing relevance floor: drop memories scoring at or below this for the
 * recipient's anchor. Tunable; the dry-run/plan reveals what was kept. */
const ROUTING_RELEVANCE_FLOOR = 0.2

export const memorySyncService = {
  /**
   * Build the downsync bundle for a project: ACTIVE project memories, ranked by
   * judge-used 履历 (LUM-539) with cold-start grace, capped to the resident-index
   * budget, rendered into Claude Code local-file shape. Pure selection logic
   * lives in {@link rankForSync} / {@link toSyncEntry}; this orchestrates the
   * two reads and the budget cap.
   */
  async buildBundle(
    projectId: string,
    opts: BuildBundleOptions = {},
    deps: BuildBundleDeps = {}
  ): Promise<ShapedSyncBundle> {
    const memories = (await memoryRepository.listForProject(
      projectId
    )) as RenderableMemory[]
    if (memories.length === 0) return { projectId, entries: [] }

    const refs: FragmentRef[] = memories.map(m => ({
      fragmentType: 'MEMORY',
      fragmentId: m.id,
    }))
    const judged = await lineageEdgeRepository.judgedUsageByFragments(refs)
    const { verdicts } = computeFragmentTrust(refs, { judged })

    // computeFragmentTrust keys by `MEMORY::<id>`; rankForSync wants bare ids.
    const trustById = new Map<string, TrustVerdict>()
    for (const m of memories) {
      const v = verdicts.get(trustKey('MEMORY', m.id))
      if (v) trustById.set(m.id, v)
    }

    // P2 routing: when an anchor is given, score each memory's relevance to the
    // recipient's work and keep only the relevant ones (per-recipient set, not a
    // full broadcast). judge-used still orders what survives; relevance feeds the
    // cold-start tiebreak.
    let selected = memories
    let relevanceScoreById: Map<string, number> | undefined
    const anchor = opts.routing?.anchorText.trim()
    if (anchor) {
      const score = deps.relevanceScore ?? bigramSimilarity
      relevanceScoreById = new Map()
      selected = []
      for (const m of memories) {
        const s = score(memoryHeadline(m), anchor)
        if (s > ROUTING_RELEVANCE_FLOOR) {
          selected.push(m)
          relevanceScoreById.set(m.id, s)
        }
      }
    }

    const ranked = rankForSync(selected, { trustById, relevanceScoreById })
    const capped = applyTokenBudget(ranked)
    const stamp = opts.syncedAtIso ?? new Date().toISOString()
    return { projectId, entries: capped.map(m => toSyncEntry(m, stamp)) }
  },
}
