import {
  injectTopK,
  injectionPrecision,
  injectionRecall,
  precisionAtK,
  scoreJudgeRun,
  scoreJudgeRuns,
  scorePolicy,
  type QueryOutcome,
  type ScoredFragment,
} from '@/scripts/eval/memory/retrieve-metrics'
import type { LineageStat } from '@/lib/lineage/ranking'

const pool: ScoredFragment[] = [
  { id: 'a', score: 0.9 },
  { id: 'b', score: 0.5 },
  { id: 'c', score: 0.95 },
  { id: 'd', score: 0.8 },
]

describe('injectTopK', () => {
  it('fixed ordering keeps corpus order and truncates to k', () => {
    const out = injectTopK(pool, { floor: null, ordering: 'fixed' }, 3)
    expect(out.map(f => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('score ordering ranks by cosine descending', () => {
    const out = injectTopK(pool, { floor: null, ordering: 'score' }, 3)
    expect(out.map(f => f.id)).toEqual(['c', 'a', 'd'])
  })

  it('floor gates fragments below it before ordering', () => {
    const out = injectTopK(pool, { floor: 0.78, ordering: 'fixed' }, 10)
    expect(out.map(f => f.id)).toEqual(['a', 'c', 'd'])
  })

  it('floor can empty the injection entirely (abstention)', () => {
    const out = injectTopK(pool, { floor: 0.99, ordering: 'score' }, 5)
    expect(out).toEqual([])
  })

  it('lineage ordering floats high-merge and sinks proven-low via prod rankByLineage', () => {
    const stats = new Map<string, LineageStat>([
      ['b', { resolvedTasks: 5, mergedTasks: 5 }], // high → top
      ['a', { resolvedTasks: 4, mergedTasks: 0 }], // low → bottom
      // c, d cold → keep input order in the middle
    ])
    const out = injectTopK(pool, { floor: null, ordering: 'lineage' }, 4, stats)
    expect(out.map(f => f.id)).toEqual(['b', 'c', 'd', 'a'])
  })
})

function outcome(
  injected: string[],
  relevant: string[],
  isAbstention = false
): QueryOutcome {
  return { queryId: 'q', isAbstention, injected, relevant: new Set(relevant) }
}

describe('precision/recall', () => {
  it('precisionAtK counts hits in the first k slots', () => {
    const o = outcome(['x', 'r1', 'y', 'r2'], ['r1', 'r2'])
    expect(precisionAtK(o, 1)).toBe(0)
    expect(precisionAtK(o, 2)).toBe(0.5)
    expect(precisionAtK(o, 4)).toBe(0.5)
  })

  it('precision over fewer-than-k injected uses the actual injected length', () => {
    const o = outcome(['r1'], ['r1', 'r2'])
    expect(precisionAtK(o, 5)).toBe(1)
    expect(injectionPrecision(o)).toBe(1)
  })

  it('empty injection is precision 1 only when nothing was relevant', () => {
    expect(injectionPrecision(outcome([], [], true))).toBe(1)
    expect(injectionPrecision(outcome([], ['r1']))).toBe(0)
    expect(precisionAtK(outcome([], [], true), 3)).toBe(1)
    expect(precisionAtK(outcome([], ['r1']), 3)).toBe(0)
  })

  it('recall is hits over gold size, null for abstention', () => {
    expect(injectionRecall(outcome(['r1', 'x'], ['r1', 'r2']))).toBe(0.5)
    expect(injectionRecall(outcome(['x'], [], true))).toBeNull()
  })
})

describe('scorePolicy', () => {
  it('aggregates positives and abstentions separately', () => {
    const outcomes: QueryOutcome[] = [
      outcome(['r1', 'x', 'y'], ['r1', 'r2']), // P@1=1, P@3=1/3, R=0.5, hit
      outcome(['x', 'y', 'z'], ['r1']), // P@1=0, P@3=0, R=0, miss
      outcome([], [], true), // abstention correct
      outcome(['x'], [], true), // abstention wrong
    ]
    const r = scorePolicy(outcomes, { floor: 0.78, ordering: 'score' }, 3)
    expect(r.nPositive).toBe(2)
    expect(r.nAbstention).toBe(2)
    expect(r.precisionAt1).toBeCloseTo(0.5)
    expect(r.precisionAt3).toBeCloseTo(1 / 6)
    expect(r.recallAtK).toBeCloseTo(0.25)
    expect(r.hitRate).toBeCloseTo(0.5)
    expect(r.abstentionEmptyRate).toBeCloseTo(0.5)
  })
})

describe('judge scoring', () => {
  const gold = new Map([['q1', new Set(['f1'])]])

  it('scoreJudgeRun computes judged precision and gold agreement', () => {
    const run = scoreJudgeRun(
      [
        { queryId: 'q1', fragmentId: 'f1', relevant: true }, // agrees
        { queryId: 'q1', fragmentId: 'f2', relevant: true }, // disagrees
      ],
      gold
    )
    expect(run.judgedPrecision).toBe(1)
    expect(run.goldAgreement).toBe(0.5)
  })

  it('scoreJudgeRuns reports per-run scores and cross-run unanimity', () => {
    const r1 = [
      { queryId: 'q1', fragmentId: 'f1', relevant: true },
      { queryId: 'q1', fragmentId: 'f2', relevant: false },
    ]
    const r2 = [
      { queryId: 'q1', fragmentId: 'f1', relevant: true },
      { queryId: 'q1', fragmentId: 'f2', relevant: true },
    ]
    const c = scoreJudgeRuns([r1, r2], gold)
    expect(c.runs).toHaveLength(2)
    expect(c.unanimousRate).toBe(0.5) // f1 unanimous, f2 split
    expect(c.meanJudgedPrecision).toBeCloseTo(0.75)
    expect(c.minJudgedPrecision).toBeCloseTo(0.5)
  })

  it('handles empty runs without NaN', () => {
    const c = scoreJudgeRuns([], gold)
    expect(c.unanimousRate).toBe(0)
    expect(c.meanJudgedPrecision).toBe(0)
    expect(c.minJudgedPrecision).toBe(0)
  })
})
