import type { RenderableMemory } from '@/lib/memory/render'
import type { TrustVerdict } from '@/types/lineage'
import {
  RELEVANCE_GATE_TOP_K,
  RELEVANCE_GATE_EMBED_FLOOR,
  RELEVANCE_GATE_LEXICAL_FLOOR,
} from './relevance-gate.constants'

export type GateMechanism =
  | 'embedding'
  | 'lexical'
  | 'fallback-all'
  | 'bypass-small'

export interface RelevanceGateInput {
  task: { title: string; description: string | null }
  projectMemories: RenderableMemory[]
  projectId: string
}

export interface SimilarityRanking {
  mechanism: 'embedding' | 'lexical'
  /** Candidate ids with a similarity score, sorted descending. Ids not present
   * score as "no match". */
  ranked: Array<{ id: string; score: number }>
}

export interface RelevanceGateDeps {
  /** Embedding-first, lexical fallback. Returns null on a hard failure (no
   * embedding key, gateway error, cold corpus with no lexical hits) so the gate
   * can degrade to the full corpus. */
  rankBySimilarity: (
    input: RelevanceGateInput
  ) => Promise<SimilarityRanking | null>
  /** Judged-used track-record verdict per candidate id (proven trust, LUM-539).
   * Ids below the cold-start grace / with no lineage edges are absent. */
  trustByFragment: (ids: string[]) => Promise<Map<string, TrustVerdict>>
}

export interface RelevanceGateResult {
  selected: RenderableMemory[]
  telemetry: {
    corpusSize: number
    selectedCount: number
    mechanism: GateMechanism
  }
  /** Similarity score per SELECTED fragment id (LUM-522). Empty for
   * bypass-small / fallback-all (no scoring happened). */
  scores: Map<string, number>
  /** Candidates the gate dropped below floor / past top-K, id+score (LUM-522).
   * Empty unless a real similarity ranking ran. */
  dropped: Array<{ id: string; score: number }>
}

/** Always-keep a memory that is proven useful by its judged-used track record
 * (LUM-539) — judged used across enough distinct tasks — even if a narrow task's
 * similarity drops it. Proven-useful memory is not collateral. A fragment's
 * merge rate no longer enters this decision. */
function isAlwaysKeep(verdict: TrustVerdict): boolean {
  return verdict.qualified
}

/**
 * Select the task-relevant subset of PROJECT memories (LUM-486). Similarity is
 * primary (top-k above a floor), unioned with always-kept high-trust fragments.
 * Never throws: any dep failure degrades to the full corpus (no worse than the
 * pre-gate behavior). Corpora at or under TOP_K bypass the gate entirely (no
 * embedding call).
 */
export async function gateProjectMemories(
  input: RelevanceGateInput,
  deps: RelevanceGateDeps
): Promise<RelevanceGateResult> {
  const { projectMemories } = input
  const corpusSize = projectMemories.length

  if (corpusSize <= RELEVANCE_GATE_TOP_K) {
    return {
      selected: projectMemories,
      telemetry: {
        corpusSize,
        selectedCount: corpusSize,
        mechanism: 'bypass-small',
      },
      scores: new Map(),
      dropped: [],
    }
  }

  let ranking: SimilarityRanking | null = null
  try {
    ranking = await deps.rankBySimilarity(input)
  } catch {
    ranking = null
  }

  if (!ranking) {
    return {
      selected: projectMemories,
      telemetry: {
        corpusSize,
        selectedCount: corpusSize,
        mechanism: 'fallback-all',
      },
      scores: new Map(),
      dropped: [],
    }
  }

  const floor =
    ranking.mechanism === 'embedding'
      ? RELEVANCE_GATE_EMBED_FLOOR
      : RELEVANCE_GATE_LEXICAL_FLOOR

  const selectedIds = new Set<string>(
    ranking.ranked
      .filter(r => r.score >= floor)
      .slice(0, RELEVANCE_GATE_TOP_K)
      .map(r => r.id)
  )

  // Union always-kept high-trust fragments (best-effort; trust failure must not
  // sink the similarity result).
  try {
    const trust = await deps.trustByFragment(projectMemories.map(m => m.id))
    for (const m of projectMemories) {
      const verdict = trust.get(m.id)
      if (verdict && isAlwaysKeep(verdict)) selectedIds.add(m.id)
    }
  } catch {
    // keep similarity-only selection
  }

  // Preserves the caller's input order (similarity + trust-union as a set); the
  // caller owns final ordering (see render.ts).
  const selected = projectMemories.filter(m => selectedIds.has(m.id))

  const scoreById = new Map(ranking.ranked.map(r => [r.id, r.score]))
  const scores = new Map<string, number>()
  for (const m of selected) {
    const s = scoreById.get(m.id)
    if (s != null) scores.set(m.id, s)
  }
  const selectedIdSet = new Set(selected.map(m => m.id))
  const dropped = ranking.ranked
    .filter(r => !selectedIdSet.has(r.id))
    .map(r => ({ id: r.id, score: r.score }))

  return {
    selected,
    telemetry: {
      corpusSize,
      selectedCount: selected.length,
      mechanism: ranking.mechanism,
    },
    scores,
    dropped,
  }
}
