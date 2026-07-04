/**
 * LUM-669: the gate-A edit integrity check. A rename/move may only permute the
 * original idea ids across clusters + the orphan zone — dropping, inventing, or
 * duplicating an id, or blanking a cluster name, is a corrupt edit (422).
 */
import {
  assertEditPartitionsUniverse,
  collectClusterGateIds,
  type ClusterGateOutput,
} from '@/lib/plan-run/cluster-gate'

const universe = new Set(['a', 'b', 'c'])

const board = (
  clusters: { name: string; ideaIds: string[] }[],
  orphans: string[]
): ClusterGateOutput => ({
  clusters: clusters.map(c => ({ ...c, thrust: 't' })),
  orphans,
})

describe('collectClusterGateIds', () => {
  it('lists every id across clusters then orphans, in order', () => {
    const out = board([{ name: 'A', ideaIds: ['a', 'b'] }], ['c'])
    expect(collectClusterGateIds(out)).toEqual(['a', 'b', 'c'])
  })
})

describe('assertEditPartitionsUniverse', () => {
  it('accepts a legal rename + move that keeps the same id set', () => {
    const edit = board([{ name: 'Renamed', ideaIds: ['a', 'c'] }], ['b'])
    expect(() => assertEditPartitionsUniverse(universe, edit)).not.toThrow()
  })

  it('rejects a dropped id with 422', () => {
    const edit = board([{ name: 'A', ideaIds: ['a', 'b'] }], [])
    expect(() => assertEditPartitionsUniverse(universe, edit)).toThrow(
      expect.objectContaining({ status: 422 })
    )
  })

  it('rejects an invented id with 422', () => {
    const edit = board([{ name: 'A', ideaIds: ['a', 'b', 'c', 'z'] }], [])
    expect(() => assertEditPartitionsUniverse(universe, edit)).toThrow(
      expect.objectContaining({ status: 422 })
    )
  })

  it('rejects a duplicated id with 422', () => {
    const edit = board([{ name: 'A', ideaIds: ['a', 'b'] }], ['b', 'c'])
    expect(() => assertEditPartitionsUniverse(universe, edit)).toThrow(
      expect.objectContaining({ status: 422 })
    )
  })

  it('rejects a blank cluster name with 422', () => {
    const edit = board([{ name: '   ', ideaIds: ['a', 'b', 'c'] }], [])
    expect(() => assertEditPartitionsUniverse(universe, edit)).toThrow(
      expect.objectContaining({ status: 422 })
    )
  })
})
