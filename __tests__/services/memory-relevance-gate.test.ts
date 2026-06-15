import {
  gateProjectMemories,
  type RelevanceGateDeps,
} from '@/lib/services/memory/relevance-gate'
import {
  RELEVANCE_GATE_TOP_K,
  RELEVANCE_GATE_TRUST_KEEP_PCT,
  RELEVANCE_GATE_TRUST_MIN_TASKS,
} from '@/lib/services/memory/relevance-gate.constants'
import type { RenderableMemory } from '@/lib/memory/render'

function mem(id: string): RenderableMemory {
  return {
    id,
    scope: 'PROJECT',
    category: 'CONVENTION',
    content: { summary: id },
  }
}

// fixture generator; corpus(n) of n memories (use n > TOP_K to defeat the bypass)
function corpus(n: number): RenderableMemory[] {
  return Array.from({ length: n }, (_, i) => mem(`m${i}`))
}

const noTrust: RelevanceGateDeps['trustByFragment'] = async () => new Map()

describe('gateProjectMemories', () => {
  test('bypasses (returns all) when corpus <= TOP_K, without calling the ranker', async () => {
    const ranker = jest.fn()
    const small = corpus(RELEVANCE_GATE_TOP_K)
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: small,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(small.length)
    expect(res.telemetry.mechanism).toBe('bypass-small')
    expect(ranker).not.toHaveBeenCalled()
  })

  test('keeps only above-floor, capped at TOP_K (embedding mechanism)', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map((c, i) => ({ id: c.id, score: 0.9 - i * 0.05 })),
    })
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(RELEVANCE_GATE_TOP_K)
    expect(res.telemetry.mechanism).toBe('embedding')
    expect(res.selected.map(m => m.id)).toEqual(
      candidates.slice(0, RELEVANCE_GATE_TOP_K).map(m => m.id)
    )
  })

  test('drops everything below floor → empty when no trust always-keeps', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map(c => ({ id: c.id, score: 0.1 })), // all below 0.5
    })
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(0)
  })

  test('unions always-kept high-trust fragment even when below similarity floor', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map(c => ({ id: c.id, score: 0.1 })), // all below floor
    })
    const trust: RelevanceGateDeps['trustByFragment'] = async () =>
      new Map([['m17', { resolvedTasks: 5, mergedTasks: 5 }]]) // 100% over 5 tasks
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: trust }
    )
    expect(res.selected.map(m => m.id)).toEqual(['m17'])
  })

  test('does NOT always-keep a low-merge-rate or thin-sample fragment', async () => {
    // Guard: the fixtures below are only meaningful if these hold.
    expect((1 / 5) * 100).toBeLessThan(RELEVANCE_GATE_TRUST_KEEP_PCT) // m1 rate (20%)
    expect(2).toBeLessThan(RELEVANCE_GATE_TRUST_MIN_TASKS) // m2 sample size
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map(c => ({ id: c.id, score: 0.1 })),
    })
    const trust: RelevanceGateDeps['trustByFragment'] = async () =>
      new Map([
        // 20% < RELEVANCE_GATE_TRUST_KEEP_PCT → not always-kept
        ['m1', { resolvedTasks: 5, mergedTasks: 1 }],
        // 100% but resolvedTasks (2) < RELEVANCE_GATE_TRUST_MIN_TASKS → not always-kept
        ['m2', { resolvedTasks: 2, mergedTasks: 2 }],
      ])
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: trust }
    )
    expect(res.selected).toHaveLength(0)
  })

  test('falls back to the full corpus when the ranker returns null', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => null
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(candidates.length)
    expect(res.telemetry.mechanism).toBe('fallback-all')
  })

  test('falls back to the full corpus when the ranker throws', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => {
      throw new Error('gateway down')
    }
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(candidates.length)
    expect(res.telemetry.mechanism).toBe('fallback-all')
  })

  test('falls back to similarity-only selection when trustByFragment throws', async () => {
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map((c, i) => ({ id: c.id, score: 0.9 - i * 0.05 })),
    })
    const trust: RelevanceGateDeps['trustByFragment'] = async () => {
      throw new Error('trust db down')
    }
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: trust }
    )
    expect(res.selected).toHaveLength(RELEVANCE_GATE_TOP_K)
    expect(res.telemetry.mechanism).toBe('embedding')
  })

  test('uses the lexical floor when mechanism is lexical', async () => {
    const candidates = corpus(20)
    // score 0.4: clears lexical floor (0.3) but NOT embed floor (0.5)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'lexical',
      ranked: candidates.map(c => ({ id: c.id, score: 0.4 })),
    })
    const res = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: candidates,
        projectId: 'p1',
      },
      { rankBySimilarity: ranker, trustByFragment: noTrust }
    )
    expect(res.selected).toHaveLength(RELEVANCE_GATE_TOP_K) // 8 kept under lexical floor
    expect(res.telemetry.mechanism).toBe('lexical')
  })

  it('exposes per-id scores for selected and the dropped below-floor set', async () => {
    const memories = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      scope: 'PROJECT' as const,
      category: 'TRAP' as const,
      content: {},
    }))
    const ranked = memories.map((m, i) => ({ id: m.id, score: 0.9 - i * 0.05 }))
    const result = await gateProjectMemories(
      {
        task: { title: 't', description: null },
        projectMemories: memories,
        projectId: 'p',
      },
      {
        rankBySimilarity: async () => ({ mechanism: 'embedding', ranked }),
        trustByFragment: async () => new Map(),
      }
    )
    expect(result.scores.get(result.selected[0]!.id)).toBeCloseTo(0.9)
    expect(result.dropped.length).toBeGreaterThan(0)
    expect(result.dropped.every(d => typeof d.score === 'number')).toBe(true)
    const sel = new Set(result.selected.map(m => m.id))
    expect(result.dropped.every(d => !sel.has(d.id))).toBe(true)
  })

  it('returns empty scores and dropped on fallback-all', async () => {
    // Corpus > TOP_K so the small-corpus bypass does NOT short-circuit — a null
    // ranking is what forces the fallback-all branch (the path under test).
    const corpus = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      scope: 'PROJECT' as const,
      category: 'TRAP' as const,
      content: {},
    }))
    const r1 = await gateProjectMemories(
      {
        task: { title: 't', description: null },
        projectMemories: corpus,
        projectId: 'p',
      },
      {
        rankBySimilarity: async () => null,
        trustByFragment: async () => new Map(),
      }
    )
    expect(r1.telemetry.mechanism).toBe('fallback-all')
    expect(r1.selected).toHaveLength(corpus.length)
    expect(r1.scores.size).toBe(0)
    expect(r1.dropped).toEqual([])
  })
})
