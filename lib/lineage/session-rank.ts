import type {
  FragmentMergeRate,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import type { RenderableMemory } from '@/lib/memory/render'
import { logger } from '@/lib/logger'
import { rankByLineage, type LineageStat } from '@/lib/lineage/ranking'

export interface SessionRankDeps {
  resolveCanonical: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
}

export interface SessionStartCards<
  S extends { id: string },
  W extends { id: string },
  F extends { id: string },
  P extends { id: string },
> {
  /**
   * Project-scope memories MUST come before task-scope ones: dedup is keep-first
   * by canonical id, so the promoted PROJECT row only wins when it precedes its
   * TASK source.
   */
  memories: RenderableMemory[]
  slack: S[]
  web: W[]
  figma: F[]
  prs: P[]
}

const statKey = (type: string, id: string): string => `${type}::${id}`

/**
 * Lineage-aware reorder of the session-start sections (LUM-279). Dedupes
 * memories by canonical id (one resolve each, reused for scoring), scores every
 * fragment via the LUM-278 merge-rate query, then stable three-tier sorts each
 * section so high-merge fragments survive the token budget and proven-low ones
 * degrade first. Cross-type priority is the caller's concern — this only
 * reorders within each section and never mixes types.
 *
 * Never throws and never drops a section: any lineage failure (DB down, resolve
 * error) returns the input unchanged, so session-start keeps injecting today's
 * fixed-order payload within its 3-second budget.
 */
export async function rankSessionStartCards<
  S extends { id: string },
  W extends { id: string },
  F extends { id: string },
  P extends { id: string },
>(
  cards: SessionStartCards<S, W, F, P>,
  deps: SessionRankDeps
): Promise<SessionStartCards<S, W, F, P>> {
  try {
    // 1. Dedup memories by canonical id. orderedMemories is project-first, so
    //    keep-first retains the promoted PROJECT row and drops the TASK dup.
    const resolved: { memory: RenderableMemory; canonicalId: string }[] = []
    const seen = new Set<string>()
    for (const memory of cards.memories) {
      const canonicalId = await deps.resolveCanonical('MEMORY', memory.id)
      if (seen.has(canonicalId)) continue
      seen.add(canonicalId)
      resolved.push({ memory, canonicalId })
    }

    // 2. Score every fragment in one query. Memory by canonical id; the other
    //    types never re-key, so their raw id is the lineage key.
    const refs: FragmentRef[] = [
      ...resolved.map(m => ({
        fragmentType: 'MEMORY' as const,
        fragmentId: m.canonicalId,
      })),
      ...cards.slack.map(s => ({
        fragmentType: 'SLACK_CONTEXT' as const,
        fragmentId: s.id,
      })),
      ...cards.web.map(w => ({
        fragmentType: 'WEB_LINK' as const,
        fragmentId: w.id,
      })),
      ...cards.figma.map(f => ({
        fragmentType: 'FIGMA' as const,
        fragmentId: f.id,
      })),
      ...cards.prs.map(p => ({
        fragmentType: 'PR' as const,
        fragmentId: p.id,
      })),
    ]
    const stats = await deps.mergeRateByFragments(refs)
    const statByKey = new Map<string, LineageStat>(
      stats.map(s => [
        statKey(s.fragmentType, s.fragmentId),
        { resolvedTasks: s.resolvedTasks, mergedTasks: s.mergedTasks },
      ])
    )

    // 3. Stable three-tier reorder within each section.
    const memories = rankByLineage(
      resolved,
      m => statKey('MEMORY', m.canonicalId),
      statByKey
    ).map(m => m.memory)

    return {
      memories,
      slack: rankByLineage(
        cards.slack,
        s => statKey('SLACK_CONTEXT', s.id),
        statByKey
      ),
      web: rankByLineage(cards.web, w => statKey('WEB_LINK', w.id), statByKey),
      figma: rankByLineage(cards.figma, f => statKey('FIGMA', f.id), statByKey),
      prs: rankByLineage(cards.prs, p => statKey('PR', p.id), statByKey),
    }
  } catch (err) {
    logger.error('rankSessionStartCards failed; using fixed order', err)
    return cards
  }
}
