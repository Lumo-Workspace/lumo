import fixture from '@/scripts/eval/memory/vectors.fixture.json'
import { evalSet } from '@/scripts/eval/memory/eval-set'
import { isPositiveCase } from '@/scripts/eval/memory/types'
import {
  cosineSimilarity,
  floorSweepWithKnee,
  recallAtK,
  type FloorCase,
  type ScoredItem,
} from '@/scripts/eval/memory/ar-metrics'

const MODEL = 'alibaba/qwen3-embedding-0.6b' // production model

type Fix = {
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}
const fx = fixture as Fix

// Build per-case scored views against the shared distractor pool (= every other
// case's `existing`).
function buildScored(model: string): {
  floorCases: FloorCase[]
  ranked: ScoredItem[][]
} {
  const floorCases: FloorCase[] = []
  const ranked: ScoredItem[][] = []
  // Exclude cross-lingual cases (xlang-*) to measure same-language AR only,
  // consistent with the calibration corpus in run.ts.
  const sameLang = evalSet.filter(c => !c.id.startsWith('xlang-'))
  for (const c of sameLang) {
    const q = fx.cases[c.id]!.candidate[model]!
    const items: ScoredItem[] = []
    let positiveScore: number | null = null
    if (isPositiveCase(c)) {
      positiveScore = cosineSimilarity(q, fx.cases[c.id]!.existing[model]!)
      items.push({ id: c.id, score: positiveScore, isPositive: true })
    }
    const distractorScores: number[] = []
    for (const other of sameLang) {
      if (other.id === c.id) continue
      const score = cosineSimilarity(q, fx.cases[other.id]!.existing[model]!)
      distractorScores.push(score)
      items.push({ id: other.id, score, isPositive: false })
    }
    floorCases.push({ positiveScore, distractorScores })
    items.sort((a, b) => b.score - a.score)
    ranked.push(items)
  }
  return { floorCases, ranked }
}

describe('AR metrics over frozen fixture (0.6b)', () => {
  const { floorCases, ranked } = buildScored(MODEL)

  it('recall@10 ≥ recall@1 (monotone in k)', () => {
    expect(recallAtK(ranked, 10)).toBeGreaterThanOrEqual(recallAtK(ranked, 1))
  })

  it('recommended floor lands in a sane band [0.4, 0.85]', () => {
    const floors = Array.from(
      { length: 31 },
      (_, i) => +(0.3 + i * 0.02).toFixed(2)
    )
    const { recommended } = floorSweepWithKnee(floorCases, floors)
    expect(recommended.floor).toBeGreaterThanOrEqual(0.4)
    expect(recommended.floor).toBeLessThanOrEqual(0.85)
  })

  it('most positive cases out-rank their best distractor', () => {
    const positives = floorCases.filter(c => c.positiveScore !== null)
    const wins = positives.filter(
      c => c.positiveScore! > Math.max(0, ...c.distractorScores)
    ).length
    expect(wins / positives.length).toBeGreaterThanOrEqual(0.6)
  })
})
