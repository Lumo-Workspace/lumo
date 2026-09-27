/**
 * @jest-environment node
 *
 * LUM-553 — the fail-closed coverage gate. Pure: no LLM, no DB.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn(() => 'model') }))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveProjectMemories: jest.fn(),
    findActiveProjectMemoryVectors: jest.fn(async () => []),
  },
}))

import {
  mapWithConcurrency,
  selectCoveredSources,
  computeProjectFoldProposals,
  refineClusterByCoherence,
  MAX_CLUSTER_SIZE,
  MIN_CLUSTER_SIZE,
  FOLD_COHERENCE_FLOOR,
} from '@/lib/services/memory/fold-compute'
import { coarseCardSchemaFor } from '@/lib/memory/fold-schemas'
import { generateObject } from 'ai'
import { memoryRepository } from '@/lib/repositories/memory.repository'

const mGen = generateObject as jest.Mock
const mActive = memoryRepository.findActiveProjectMemories as jest.Mock
const mVectors = memoryRepository.findActiveProjectMemoryVectors as jest.Mock

/** A unit vector pointing mostly along axis `axis` (of `dims`), with a small
 *  jitter so same-axis members are ~0.99 cosine-similar and cross-axis members
 *  are ~0 — a controllable stand-in for real embeddings. */
const axisVec = (axis: number, dims = 4, jitter = 0): number[] =>
  Array.from({ length: dims }, (_, d) =>
    d === axis ? 1 : d === (axis + 1) % dims ? jitter : 0
  )

/** Route the shared generateObject mock to clustering / synthesis / coverage by
 *  the distinct system prompt of each phase. `clusterOf` returns the id groups
 *  the clustering LLM "proposes"; synthesis emits a valid TRAP coarse card whose
 *  workaround carries COVER_TOKEN; coverage marks every source covered, quoting
 *  COVER_TOKEN (a verbatim substring of the coarse card, so the gate passes). */
const COVER_TOKEN = 'covered-token-xyz'
const wireFoldPipeline = (clusterOf: (ids: string[]) => string[][]) => {
  mGen.mockImplementation(async ({ system, prompt }: any) => {
    if (system.includes('Group cards that concern')) {
      const { cards } = JSON.parse(prompt)
      return {
        object: {
          clusters: clusterOf(cards.map((c: { id: string }) => c.id)).map(
            sourceMemoryIds => ({ sourceMemoryIds })
          ),
        },
      }
    }
    if (system.includes('into ONE coarse')) {
      return {
        object: {
          summary: 'S',
          trigger: 'T',
          outcome: 'O',
          workaround: `${COVER_TOKEN} consolidated fixes`,
        },
      }
    }
    // coverage judge
    const { sources } = JSON.parse(prompt)
    return {
      object: {
        verdicts: sources.map((s: { sourceMemoryId: string }) => ({
          sourceMemoryId: s.sourceMemoryId,
          covered: true,
          evidenceQuote: COVER_TOKEN,
        })),
      },
    }
  })
}

const trapCards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    category: 'TRAP',
    content: {
      trigger: `trigger ${i}`,
      outcome: `outcome ${i}`,
      workaround: `fix ${i}`,
    },
  }))

describe('computeProjectFoldProposals surfaces a degraded LLM pipeline (LUM-555)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mActive.mockResolvedValue(trapCards(4)) // one foldable TRAP bucket
  })

  it('reports degraded true on clustering error and false when genuinely empty', async () => {
    // A clustering LLM call that errors (retries exhausted) → the pipeline is
    // degraded: we cannot tell whether there was anything to fold.
    mGen.mockRejectedValue(new Error('gateway down'))
    const errored = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })
    expect(errored.proposals).toEqual([])
    expect(errored.degraded).toBe(true)

    // A clustering call that SUCCEEDS but legitimately finds no clusters → not
    // degraded: there is genuinely nothing to fold, prune may proceed.
    mGen.mockReset()
    mGen.mockResolvedValue({ object: { clusters: [] } })
    const empty = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })
    expect(empty.proposals).toEqual([])
    expect(empty.degraded).toBe(false)
  })
})

describe('selectCoveredSources', () => {
  it('fold coverage gate is fail-closed and supersede set equals covered set', () => {
    const coarseText =
      'prisma migrate dev rejects P3008 drift; workaround is db execute then migrate resolve. ' +
      'jest by-name checkpointers fake-pass on zero match; use scripts/jest-t.ts.'
    const sources = [
      { id: 'covered-real', text: 'P3008 drift workaround' },
      { id: 'covered-but-quote-absent', text: 'something' },
      { id: 'judged-uncovered', text: 'unrelated' },
      { id: 'no-verdict', text: 'orphan' },
      { id: 'empty-quote', text: 'x' },
    ]
    const verdicts = [
      {
        sourceMemoryId: 'covered-real',
        covered: true,
        evidenceQuote: 'db execute then migrate resolve',
      },
      {
        sourceMemoryId: 'covered-but-quote-absent',
        covered: true,
        evidenceQuote: 'this phrase is not in the coarse card',
      },
      {
        sourceMemoryId: 'judged-uncovered',
        covered: false,
        evidenceQuote: 'jest by-name checkpointers',
      },
      { sourceMemoryId: 'empty-quote', covered: true, evidenceQuote: '' },
      // 'no-verdict' deliberately omitted
    ]

    const covered = selectCoveredSources(coarseText, sources, verdicts)

    // Only the source whose verdict is covered=true AND whose quote is actually
    // present in the coarse card survives. Everything uncertain is dropped.
    expect(covered).toEqual(['covered-real'])
  })
})

describe('coarseCardSchemaFor enforces the per-category coarse-card shape', () => {
  it('accepts a structured TRAP coarse card and rejects a free {id,text} blob', () => {
    const schema = coarseCardSchemaFor('TRAP')

    // Structured per-category content → valid (the model is forced into this).
    expect(
      schema.safeParse({
        summary: 'Prisma migrations',
        trigger: 'applying migrations across environments',
        outcome: 'schema drift / 500s',
        workaround: '(1) migrate deploy on prod (2) regenerate client',
      }).success
    ).toBe(true)

    // The LUM-553 dogfood failure shape: a free {id,text} blob → rejected, so it
    // can never reach parseMemoryContent and silently fold nothing.
    expect(
      schema.safeParse({ id: 'coarse-prisma', text: '(1)… (2)… (3)…' }).success
    ).toBe(false)
  })
})

describe('refineClusterByCoherence — embedding coherence guard (LUM-556)', () => {
  const opts = {
    floor: FOLD_COHERENCE_FLOOR,
    minSize: MIN_CLUSTER_SIZE,
    maxSize: MAX_CLUSTER_SIZE,
  }

  it('refineClusterByCoherence splits a mixed-subsystem cluster and drops outliers', () => {
    // The LLM lumped two unrelated subsystems + a lone outlier into ONE cluster
    // (the prod over-merge). Members: 3 along axis 0, 3 along axis 1, 1 along
    // axis 2 (similar to neither) — the bug shape, in miniature.
    const vectorById = new Map<string, number[]>([
      ['a1', axisVec(0, 4, 0.02)],
      ['a2', axisVec(0, 4, 0.03)],
      ['a3', axisVec(0, 4, 0.01)],
      ['b1', axisVec(1, 4, 0.02)],
      ['b2', axisVec(1, 4, 0.03)],
      ['b3', axisVec(1, 4, 0.01)],
      ['outlier', axisVec(2, 4, 0.02)],
    ])
    const refined = refineClusterByCoherence(
      ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'outlier'],
      vectorById,
      opts
    )

    // Two coherent sub-clusters, the cross-subsystem merge undone.
    expect(refined).toHaveLength(2)
    const flat = refined.flat()
    expect(refined).toContainEqual(['a1', 'a2', 'a3'])
    expect(refined).toContainEqual(['b1', 'b2', 'b3'])
    // The lone outlier is folded into nothing — stays granular.
    expect(flat).not.toContain('outlier')
  })

  it('caps a coherent cluster at MAX_CLUSTER_SIZE', () => {
    // 20 genuinely-similar members (all axis 0): coherent, so they are NOT split
    // on dissimilarity — only the hard size cap bounds them.
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`)
    const vectorById = new Map(
      ids.map((id, i) => [id, axisVec(0, 4, i * 0.001)])
    )
    const refined = refineClusterByCoherence(ids, vectorById, opts)

    expect(refined.length).toBeGreaterThan(0)
    for (const sub of refined)
      expect(sub.length).toBeLessThanOrEqual(MAX_CLUSTER_SIZE)
    // No member is lost to chunking — every coherent card still folds somewhere.
    expect(refined.flat().sort()).toEqual([...ids].sort())
  })

  it('refineClusterByCoherence drops an oversized cluster when vectors are missing', () => {
    // Cold/backfilling corpus: no embeddings for these members. Fail-closed —
    // an oversized cluster we CANNOT validate must never be folded whole.
    const oversized = Array.from({ length: 20 }, (_, i) => `x${i}`)
    expect(refineClusterByCoherence(oversized, new Map(), opts)).toEqual([])

    // But a within-bounds cluster with no vectors is preserved (small clusters
    // were never the over-merge problem; don't regress fold on a cold corpus).
    const small = ['s1', 's2', 's3']
    expect(refineClusterByCoherence(small, new Map(), opts)).toEqual([small])
  })
})

describe('computeProjectFoldProposals respects the cluster size cap (LUM-556)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('computeProjectFoldProposals never emits a proposal exceeding MAX_CLUSTER_SIZE', async () => {
    // 20 coherent TRAP cards; the clustering LLM over-merges ALL 20 into one
    // cluster (the bug). The cap must break it into ≤MAX coarse cards — never one.
    const cards = trapCards(20)
    mActive.mockResolvedValue(cards)
    mVectors.mockResolvedValue(
      cards.map((c, i) => ({ id: c.id, vector: axisVec(0, 4, i * 0.001) }))
    )
    wireFoldPipeline(ids => [ids]) // one cluster of everything

    const { proposals } = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })

    expect(proposals.length).toBeGreaterThan(1) // the blob was split, not folded whole
    for (const p of proposals)
      expect(p.sourceIds.length).toBeLessThanOrEqual(MAX_CLUSTER_SIZE)
  })

  it('a coherent in-bounds cluster still produces a fold proposal', async () => {
    // Guard against over-correcting into "fold nothing": a small, coherent
    // cluster must still fold exactly as before.
    const cards = trapCards(4)
    mActive.mockResolvedValue(cards)
    mVectors.mockResolvedValue(
      cards.map((c, i) => ({ id: c.id, vector: axisVec(0, 4, i * 0.001) }))
    )
    wireFoldPipeline(ids => [ids])

    const { proposals } = await computeProjectFoldProposals('proj-1', {
      maxProposals: 6,
    })

    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.sourceIds.sort()).toEqual(cards.map(c => c.id).sort())
  })
})

describe('mapWithConcurrency', () => {
  it('preserves order, processes all items, and never exceeds the cap', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return n * 2
    })

    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]) // order preserved, all run
    expect(peak).toBeLessThanOrEqual(3) // cap respected
    expect(peak).toBeGreaterThan(1) // actually concurrent (not serialized)
  })
})
