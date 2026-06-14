import {
  gateProjectMemories,
  type RelevanceGateDeps,
} from '@/lib/services/memory/relevance-gate'
import { RELEVANCE_GATE_TOP_K } from '@/lib/services/memory/relevance-gate.constants'
import type { RenderableMemory } from '@/lib/memory/render'

function mem(id: string): RenderableMemory {
  return {
    id,
    scope: 'PROJECT',
    category: 'CONVENTION',
    content: { summary: id },
  }
}

// candidates large enough to defeat the bypass (TOP_K + a margin)
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
    const candidates = corpus(20)
    const ranker: RelevanceGateDeps['rankBySimilarity'] = async () => ({
      mechanism: 'embedding',
      ranked: candidates.map(c => ({ id: c.id, score: 0.1 })),
    })
    const trust: RelevanceGateDeps['trustByFragment'] = async () =>
      new Map([
        ['m1', { resolvedTasks: 5, mergedTasks: 1 }], // 20% — below TRUST_KEEP_PCT
        ['m2', { resolvedTasks: 2, mergedTasks: 2 }], // 100% but < MIN_TASKS
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
})
