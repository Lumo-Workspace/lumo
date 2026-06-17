import fixture from '@/scripts/eval/memory/vectors.fixture.json'
import { evalSet } from '@/scripts/eval/memory/eval-set'
import { isPositiveCase } from '@/scripts/eval/memory/types'
import {
  nearDupClusters,
  nearDupRetrievalReport,
  type NearDupPair,
  type VecItem,
} from '@/scripts/eval/memory/near-dup-cluster'
import { EMBEDDING_SCORE_FLOOR } from '@/lib/services/memory/embedding-neighbor-retriever'

const MODEL = 'alibaba/qwen3-embedding-0.6b' // production model

type Fix = {
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}
const fx = fixture as Fix

// Labeled near-duplicate pairs = every non-UNRELATED case (DUPLICATE /
// REFINEMENT / CONTRADICTION), same-language only — these are pairs whose
// candidate SHOULD retrieve its own existing neighbor so reconcile can merge.
function nearDupPairs(): NearDupPair[] {
  return evalSet
    .filter(c => !c.id.startsWith('xlang-'))
    .filter(isPositiveCase)
    .map(c => ({
      id: c.id,
      candidate: fx.cases[c.id]!.candidate[MODEL]!,
      existing: fx.cases[c.id]!.existing[MODEL]!,
    }))
}

describe('near-duplicate cluster metric (LUM-538)', () => {
  // Criterion 2 — the harness now COMPUTES a near-dup cluster count. Proven on a
  // synthetic fixture with known clusters (deterministic union-find correctness)
  // plus a smoke pass over the real frozen fixture.
  it('near-duplicate cluster count', () => {
    // Two tight pairs + one isolated point. a1≈a2, b1≈b2, c1 alone.
    const items: VecItem[] = [
      { id: 'a1', vector: [1, 0] },
      { id: 'a2', vector: [1, 0.05] },
      { id: 'b1', vector: [0, 1] },
      { id: 'b2', vector: [0.05, 1] },
      { id: 'c1', vector: [1, 1] },
    ]
    // cos(a1,a2)=cos(b1,b2)=0.9988; cos(a-cluster, b-cluster)≈0.05; c1 ~0.71 to both.
    const clusters = nearDupClusters(items, 0.9)
    expect(clusters).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ])
    // Floor sensitivity: tighten past the pair similarity → no clusters.
    expect(nearDupClusters(items, 0.999)).toEqual([])
    // Transitivity: a chain a1–a2–a3 is one cluster, not two.
    expect(
      nearDupClusters(
        [
          { id: 'a1', vector: [1, 0] },
          { id: 'a2', vector: [1, 0.05] },
          { id: 'a3', vector: [1, 0.1] },
        ],
        0.9
      )
    ).toEqual([['a1', 'a2', 'a3']])

    // Smoke over the real frozen fixture: the metric runs and reports a count.
    const corpus: VecItem[] = evalSet
      .filter(c => !c.id.startsWith('xlang-'))
      .map(c => ({ id: c.id, vector: fx.cases[c.id]!.existing[MODEL]! }))
    const residual = nearDupClusters(corpus, 0.85)
    expect(Array.isArray(residual)).toBe(true)
    expect(residual.length).toBeGreaterThanOrEqual(0)
  })

  // Criterion 3 — at the SHIPPED floor, retrieval catches near-duplicates (so
  // reconcile can merge them) at or above a fixed literal target. Anchored to a
  // constant, never vs origin/main. At the old 0.78 knee recall was 0.846 (< the
  // 0.87 target → this guard would fail), which is exactly the leak LUM-538 fixes
  // by moving the floor to a recall-favoring 0.74 (recall 0.897).
  it('reconcile merges near-duplicates at or above baseline', () => {
    const TARGET_RECALL = 0.87
    const report = nearDupRetrievalReport(nearDupPairs(), EMBEDDING_SCORE_FLOOR)

    expect(report.total).toBeGreaterThanOrEqual(30)
    // The floor must stay in the recall-favoring direction (off the 0.78 knee).
    expect(EMBEDDING_SCORE_FLOOR).toBeLessThanOrEqual(0.78)
    expect(report.recall).toBeGreaterThanOrEqual(TARGET_RECALL)

    // Guard the target is meaningful, not trivially satisfiable: the OLD 0.78
    // knee leaks below it (proves the floor change is load-bearing).
    const atOldKnee = nearDupRetrievalReport(nearDupPairs(), 0.78)
    expect(atOldKnee.recall).toBeLessThan(TARGET_RECALL)
  })
})
