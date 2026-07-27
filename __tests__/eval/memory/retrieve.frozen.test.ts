/**
 * LUM-414 frozen-fixture retrieve tests — deterministic, CI-gated. Guards the
 * harness's structural integrity and the ABSTENTION NEGATIVE CONTROL: a task
 * query with no relevant memory anywhere in the pool must score entirely below
 * the production floor (so a floor-gated injection abstains). These assert
 * fixture properties on purpose — if regenerating embeddings makes a negative
 * control clear the floor, the contract is broken and the corpus (or the
 * floor) must be revisited, not the test.
 */
import {
  outcomesFor,
  scoredPoolFor,
  validateRetrieveFixtures,
} from '@/scripts/eval/memory/retrieve-report'
import {
  retrieveQuerySet,
  retrievePool,
} from '@/scripts/eval/memory/retrieve-set'
import { scorePolicy } from '@/scripts/eval/memory/retrieve-metrics'
import { EMBEDDING_SCORE_FLOOR } from '@/lib/services/memory/embedding-neighbor-retriever'

describe('retrieve frozen fixtures (LUM-414)', () => {
  it('fixtures cover every query and every pool fragment', () => {
    expect(validateRetrieveFixtures()).toEqual([])
  })

  it('abstention negative controls score entirely below the production floor', () => {
    const abstentions = retrieveQuerySet.filter(q => q.relevantIds.length === 0)
    expect(abstentions.length).toBeGreaterThanOrEqual(5)
    for (const q of abstentions) {
      const max = scoredPoolFor(q).reduce((m, f) => Math.max(m, f.score), 0)
      expect({
        id: q.id,
        max,
        belowFloor: max < EMBEDDING_SCORE_FLOOR,
      }).toEqual({ id: q.id, max, belowFloor: true })
    }
  })

  it('a floor-gated injection abstains on every negative control', () => {
    const outcomes = outcomesFor({
      ordering: 'score',
      floor: EMBEDDING_SCORE_FLOOR,
    })
    for (const o of outcomes.filter(x => x.isAbstention)) {
      expect({ id: o.queryId, injected: o.injected }).toEqual({
        id: o.queryId,
        injected: [],
      })
    }
  })

  it('relevance ordering beats the fixed (≈today) ordering by a wide margin', () => {
    // Directional guard, not a pinned value: the harness exists because
    // relevance-blind injection has near-zero Precision@k on this corpus.
    const k = 5
    const fixed = scorePolicy(
      outcomesFor({ ordering: 'fixed', floor: null }, k),
      { ordering: 'fixed', floor: null },
      k
    )
    const score = scorePolicy(
      outcomesFor({ ordering: 'score', floor: null }, k),
      { ordering: 'score', floor: null },
      k
    )
    expect(score.recallAtK).toBeGreaterThan(fixed.recallAtK + 0.3)
    expect(score.precisionAtKFull).toBeGreaterThan(fixed.precisionAtKFull)
  })

  it('every gold query produces one outcome over the full pool', () => {
    const outcomes = outcomesFor({ ordering: 'score', floor: null })
    expect(outcomes).toHaveLength(retrieveQuerySet.length)
    expect(retrievePool.length).toBeGreaterThanOrEqual(45)
  })
})
