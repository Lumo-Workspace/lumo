import { unreachableMergedFragments } from '@/lib/services/memory/disclosure-reachability'

describe('unreachableMergedFragments', () => {
  it('flags merged fragments the new model would hide', () => {
    const merged = [
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
      { fragmentType: 'MEMORY', fragmentId: 'm2' },
    ]
    const reachable = new Set(['MEMORY:m1']) // m2 absent
    expect(unreachableMergedFragments(merged, reachable)).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'm2' },
    ])
  })
  it('returns [] when every merged fragment is reachable', () => {
    const merged = [{ fragmentType: 'MEMORY', fragmentId: 'm1' }]
    expect(unreachableMergedFragments(merged, new Set(['MEMORY:m1']))).toEqual(
      []
    )
  })
  it('returns [] for no merged fragments', () => {
    expect(unreachableMergedFragments([], new Set())).toEqual([])
  })
})
