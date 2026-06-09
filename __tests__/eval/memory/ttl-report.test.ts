import {
  aggregateUsedRate,
  type UsageRow,
} from '@/scripts/eval/memory/ttl-report'

describe('aggregateUsedRate', () => {
  const rows: UsageRow[] = [
    { category: 'CONVENTION', used: true },
    { category: 'CONVENTION', used: false },
    { category: 'CONVENTION', used: null }, // not voted → excluded from denom
    { category: 'PROCEDURAL', used: true },
  ]
  it('used-rate = voted-used / voted, per category', () => {
    const r = aggregateUsedRate(rows)
    expect(r.CONVENTION).toEqual({ usedRate: 0.5, voted: 2, used: 1 })
    expect(r.PROCEDURAL).toEqual({ usedRate: 1, voted: 1, used: 1 })
  })

  it('returns no entry for a category with only unvoted rows', () => {
    const r = aggregateUsedRate([{ category: 'TRAP', used: null }])
    expect(r.TRAP).toBeUndefined()
  })
})
