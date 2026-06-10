import {
  retrievePool,
  retrieveQuerySet,
  retrieveQueryText,
  syntheticLineageStats,
  validateRetrieveSet,
} from '@/scripts/eval/memory/retrieve-set'
import { LINEAGE_MIN_RESOLVED_TASKS } from '@/lib/services/lineage-signal'

const poolIds = new Set(retrievePool.map(c => c.id))

describe('retrieve gold set (LUM-414)', () => {
  it('is internally valid (ids, relevance references, abstention shape)', () => {
    expect(validateRetrieveSet(retrieveQuerySet, poolIds)).toEqual([])
  })

  it('the pool is the same-language corpus in corpus order', () => {
    expect(retrievePool.some(c => c.id.startsWith('xlang-'))).toBe(false)
    expect(retrievePool.length).toBeGreaterThanOrEqual(45)
  })

  it('has enough positive queries and abstention negative controls', () => {
    const abstentions = retrieveQuerySet.filter(q =>
      q.id.startsWith('rq-abstain-')
    )
    const positives = retrieveQuerySet.filter(
      q => !q.id.startsWith('rq-abstain-')
    )
    expect(positives.length).toBeGreaterThanOrEqual(15)
    expect(abstentions.length).toBeGreaterThanOrEqual(5)
    for (const q of abstentions) expect(q.relevantIds).toEqual([])
    for (const q of positives) expect(q.relevantIds.length).toBeGreaterThan(0)
  })

  it('query text joins title and description', () => {
    const q = retrieveQuerySet[0]!
    expect(retrieveQueryText(q)).toBe(`${q.title}\n${q.description}`)
  })

  it('synthetic lineage stats are a deterministic null model with all three tiers', () => {
    const ids = retrievePool.map(c => c.id)
    const stats = syntheticLineageStats(ids)
    expect(syntheticLineageStats(ids)).toEqual(stats) // deterministic
    const values = [...stats.values()]
    // Stats that exist must clear the prod cold-start floor so the ablation
    // actually exercises the high/low tiers of rankByLineage.
    for (const s of values) {
      expect(s.resolvedTasks).toBeGreaterThanOrEqual(LINEAGE_MIN_RESOLVED_TASKS)
    }
    expect(values.some(s => s.mergedTasks / s.resolvedTasks >= 0.5)).toBe(true)
    expect(values.some(s => s.mergedTasks / s.resolvedTasks < 0.5)).toBe(true)
    expect(stats.size).toBeLessThan(ids.length) // some fragments stay cold
  })
})
