import {
  cosineSimilarity,
  floorSweep,
  floorSweepWithKnee,
  recallAtK,
  separation,
  type ScoredItem,
} from '@/scripts/eval/memory/ar-metrics'

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, matches pgvector cosine (normalized)', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    // non-unit vectors: must normalize, not raw-dot
    expect(cosineSimilarity([2, 0], [3, 0])).toBeCloseTo(1)
  })
  it('returns 0 on a zero vector (no throw)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('floorSweep', () => {
  // Two queries. q1 is a positive case: positive score 0.8, distractor 0.4.
  // q2 is an ADD case (no positive): best pool score 0.5 (any admit = FP).
  const cases = [
    { positiveScore: 0.8, distractorScores: [0.4, 0.2] },
    { positiveScore: null, distractorScores: [0.5, 0.3] },
  ]
  it('at floor 0.6: q1 TP (0.8≥.6), q1 distractors rejected, q2 all rejected → P=1 R=1', () => {
    const row = floorSweep(cases, [0.6]).find(r => r.floor === 0.6)!
    expect(row.precision).toBeCloseTo(1)
    expect(row.recall).toBeCloseTo(1)
    expect(row.f1).toBeCloseTo(1)
  })
  it('at floor 0.3: q1 distractor 0.4 admitted (FP), q2 0.5 & 0.3 admitted (FP) → precision drops', () => {
    const row = floorSweep(cases, [0.3]).find(r => r.floor === 0.3)!
    // TP=1 (q1 positive), FP=3 (q1 0.4; q2 0.5,0.3) → precision 1/4
    expect(row.precision).toBeCloseTo(0.25)
    expect(row.recall).toBeCloseTo(1)
  })
  it('recommends the floor with the best F1', () => {
    const { rows, recommended } = floorSweepWithKnee(cases, [0.3, 0.6])
    expect(rows).toHaveLength(2)
    expect(recommended.floor).toBe(0.6)
  })
})

describe('recallAtK', () => {
  const ranked: ScoredItem[][] = [
    // case A: positive is rank 1 → in top-1
    [
      { id: 'pos', score: 0.9, isPositive: true },
      { id: 'd', score: 0.4, isPositive: false },
    ],
    // case B: positive is rank 2 → in top-2, not top-1
    [
      { id: 'd', score: 0.7, isPositive: false },
      { id: 'pos', score: 0.6, isPositive: true },
    ],
  ]
  it('recall@1 = 0.5, recall@2 = 1.0 (monotone in k)', () => {
    expect(recallAtK(ranked, 1)).toBeCloseTo(0.5)
    expect(recallAtK(ranked, 2)).toBeCloseTo(1.0)
  })
})

describe('separation', () => {
  it('margin = positive − best distractor, averaged', () => {
    const s = separation([
      { positiveScore: 0.8, distractorScores: [0.4, 0.5] }, // margin 0.3
      { positiveScore: 0.9, distractorScores: [0.7] }, // margin 0.2
    ])
    expect(s.mean).toBeCloseTo(0.25)
    expect(s.min).toBeCloseTo(0.2)
  })
})
