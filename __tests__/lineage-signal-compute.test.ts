import {
  computeFragmentTrust,
  LINEAGE_MIN_USED_TASKS,
  LINEAGE_MIN_RESOLVED_TASKS,
} from '@/lib/services/lineage-signal'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'

const ref = (id: string): FragmentRef => ({
  fragmentType: 'MEMORY',
  fragmentId: id,
})
const key = (id: string) => `MEMORY::${id}`

describe('computeFragmentTrust', () => {
  it('prefers the usage signal once it clears the usage floor', () => {
    const { verdicts } = computeFragmentTrust([ref('a')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'a',
          resolvedTasks: 8,
          mergedTasks: 8,
        },
      ],
      usage: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'a',
          usedResolvedTasks: LINEAGE_MIN_USED_TASKS,
          usedMergedTasks: 3,
        },
      ],
    })
    expect(verdicts.get(key('a'))).toEqual({
      kind: 'usage',
      resolvedTasks: LINEAGE_MIN_USED_TASKS,
      mergedTasks: 3,
      pct: 100,
    })
  })

  it('falls back to presence when usage is below the floor', () => {
    const { verdicts } = computeFragmentTrust([ref('b')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'b',
          resolvedTasks: 4,
          mergedTasks: 1,
        },
      ],
      usage: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'b',
          usedResolvedTasks: LINEAGE_MIN_USED_TASKS - 1,
          usedMergedTasks: 1,
        },
      ],
    })
    expect(verdicts.get(key('b'))).toEqual({
      kind: 'presence',
      resolvedTasks: 4,
      mergedTasks: 1,
      pct: 25,
    })
  })

  it('excludes zero-variance presence fragments and counts them', () => {
    const res = computeFragmentTrust([ref('c')], {
      universe: 5,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'c',
          resolvedTasks: 5,
          mergedTasks: 5,
        },
      ],
      usage: [],
    })
    expect(res.verdicts.has(key('c'))).toBe(false)
    expect(res.excludedZeroVariance).toBe(1)
  })

  it('gates presence below the cold-start floor (no verdict, not excluded)', () => {
    const res = computeFragmentTrust([ref('d')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'd',
          resolvedTasks: LINEAGE_MIN_RESOLVED_TASKS - 1,
          mergedTasks: 1,
        },
      ],
      usage: [],
    })
    expect(res.verdicts.has(key('d'))).toBe(false)
    expect(res.excludedZeroVariance).toBe(0)
  })

  it('produces no verdict for a fragment with no edge history', () => {
    const res = computeFragmentTrust([ref('e')], {
      universe: 10,
      presence: [],
      usage: [],
    })
    expect(res.verdicts.size).toBe(0)
    expect(res.excludedZeroVariance).toBe(0)
  })

  it('dedupes repeated refs (counts a zero-variance fragment once)', () => {
    const res = computeFragmentTrust([ref('f'), ref('f')], {
      universe: 3,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'f',
          resolvedTasks: 3,
          mergedTasks: 2,
        },
      ],
      usage: [],
    })
    expect(res.excludedZeroVariance).toBe(1)
  })
})
