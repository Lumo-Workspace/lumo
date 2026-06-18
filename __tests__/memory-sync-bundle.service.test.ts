/**
 * @jest-environment node
 */
import { rankForSync } from '@/lib/services/memory/sync-bundle'
import type { RenderableMemory } from '@/lib/memory/render'
import type { TrustVerdict } from '@/lib/services/lineage-signal'

const mem = (id: string): RenderableMemory => ({
  id,
  scope: 'PROJECT',
  category: 'CONVENTION',
  content: { rule: id, scope: 'x' },
})

const verdict = (j: number, a: number): TrustVerdict => ({
  judgedUsedTasks: j,
  auditedTasks: a,
  appearanceTasks: a,
  usefulnessPct: a ? Math.round((j / a) * 100) : 0,
  qualified: j >= 3,
})

describe('rankForSync', () => {
  it('orders judge-used qualified memories ahead of cold-start ones', () => {
    const memories = [mem('cold'), mem('proven')]
    const trustById = new Map<string, TrustVerdict>([
      ['proven', verdict(5, 6)], // qualified
      ['cold', verdict(0, 0)], // never audited → cold-start
    ])
    const out = rankForSync(memories, { trustById })
    expect(out.map(m => m.id)).toEqual(['proven', 'cold'])
  })

  it('does NOT treat an unaudited (used=null) memory as unused/last-resort below a 0%-useful audited one', () => {
    const memories = [mem('audited0'), mem('coldnew')]
    const trustById = new Map<string, TrustVerdict>([
      ['audited0', verdict(0, 5)], // audited, judged-unused → proven low-value
      ['coldnew', verdict(0, 0)], // unaudited = unknown → cold-start grace
    ])
    const out = rankForSync(memories, { trustById })
    // unknown (coldnew) must rank ABOVE a confirmed-0%-useful audited memory
    expect(out.indexOf(memories[1]!)).toBeLessThan(out.indexOf(memories[0]!))
  })

  it('within the proven tier, orders by usefulness then judged-used count', () => {
    const memories = [mem('lo'), mem('hi')]
    const trustById = new Map<string, TrustVerdict>([
      ['hi', verdict(9, 10)], // 90%
      ['lo', verdict(3, 10)], // 30%
    ])
    const out = rankForSync(memories, { trustById })
    expect(out.map(m => m.id)).toEqual(['hi', 'lo'])
  })

  it('breaks cold-start ties by relevance score when provided', () => {
    const memories = [mem('a'), mem('b')]
    const out = rankForSync(memories, {
      trustById: new Map(),
      relevanceScoreById: new Map([
        ['b', 0.9],
        ['a', 0.1],
      ]),
    })
    expect(out.map(m => m.id)).toEqual(['b', 'a'])
  })
})
