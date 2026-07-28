import {
  clusterIdeaUniverse,
  resolveKeptIdeaIds,
  selectStarredAligned,
  MAX_STARRED,
} from '@/lib/plan-run/gate-b'
import { clusterIdForIndex } from '@/lib/plan-run/cluster-gate'
import { confirmAlignGateSchema } from '@/lib/validation/plan-run'

// ── selectStarredAligned ─────────────────────────────────────────────────────

describe('selectStarredAligned', () => {
  const c = (
    clusterId: string,
    verdict: 'ALIGNED' | 'UNRELATED' | 'CONFLICT',
    starred: boolean
  ) => ({ clusterId, verdict, starred })

  it('keeps only starred AND aligned clusters', () => {
    const out = selectStarredAligned([
      c('a', 'ALIGNED', true),
      c('b', 'ALIGNED', false), // aligned but not starred
      c('c', 'UNRELATED', true), // starred but not aligned
      c('d', 'CONFLICT', true), // starred but not aligned
    ])
    expect(out.map(x => x.clusterId)).toEqual(['a'])
  })

  it('caps at MAX_STARRED, preserving confirmed order', () => {
    const out = selectStarredAligned([
      c('a', 'ALIGNED', true),
      c('b', 'ALIGNED', true),
      c('c', 'ALIGNED', true),
    ])
    expect(out).toHaveLength(MAX_STARRED)
    expect(out.map(x => x.clusterId)).toEqual(['a', 'b'])
  })

  it('returns empty when nothing qualifies', () => {
    expect(selectStarredAligned([c('a', 'UNRELATED', true)])).toEqual([])
  })
})

// ── confirmAlignGateSchema ───────────────────────────────────────────────────

describe('confirmAlignGateSchema', () => {
  const cluster = (over: Record<string, unknown> = {}) => ({
    clusterId: 'c1',
    verdict: 'ALIGNED',
    starred: false,
    rationale: 'x',
    ...over,
  })

  it('accepts a valid single-cluster payload', () => {
    expect(
      confirmAlignGateSchema.safeParse({ clusters: [cluster()] }).success
    ).toBe(true)
  })

  it('rejects an unknown verdict value', () => {
    const r = confirmAlignGateSchema.safeParse({
      clusters: [cluster({ verdict: 'MAYBE' })],
    })
    expect(r.success).toBe(false)
  })

  it('rejects starring a non-ALIGNED cluster', () => {
    const r = confirmAlignGateSchema.safeParse({
      clusters: [cluster({ verdict: 'CONFLICT', starred: true })],
    })
    expect(r.success).toBe(false)
  })

  it(`rejects more than ${MAX_STARRED} starred clusters`, () => {
    const r = confirmAlignGateSchema.safeParse({
      clusters: [
        cluster({ clusterId: 'a', starred: true }),
        cluster({ clusterId: 'b', starred: true }),
        cluster({ clusterId: 'c', starred: true }),
      ],
    })
    expect(r.success).toBe(false)
  })

  it('rejects an empty cluster list', () => {
    expect(confirmAlignGateSchema.safeParse({ clusters: [] }).success).toBe(
      false
    )
  })

  it('accepts an omitted ideaIds (keep the whole cluster)', () => {
    expect(
      confirmAlignGateSchema.safeParse({ clusters: [cluster()] }).success
    ).toBe(true)
  })

  it('accepts an explicit kept-idea subset', () => {
    expect(
      confirmAlignGateSchema.safeParse({
        clusters: [cluster({ ideaIds: ['i1'] })],
      }).success
    ).toBe(true)
  })

  it('rejects starring a cluster whose ideas were all unchecked', () => {
    const r = confirmAlignGateSchema.safeParse({
      clusters: [cluster({ starred: true, ideaIds: [] })],
    })
    expect(r.success).toBe(false)
  })

  it('allows an emptied cluster that is not starred', () => {
    expect(
      confirmAlignGateSchema.safeParse({
        clusters: [cluster({ starred: false, ideaIds: [] })],
      }).success
    ).toBe(true)
  })
})

// ── ideaUniverseByClusterId / resolveKeptIdeaIds (LUM-688) ───────────────────

describe('clusterIdeaUniverse', () => {
  const clustering = {
    clusters: [
      { name: 'A', thrust: '', ideaIds: ['i1', 'i2'] },
      { name: 'B', thrust: '', ideaIds: ['i3'] },
    ],
    orphans: ['i9'],
  }

  it('resolves a cluster by its positional align id', () => {
    expect(clusterIdeaUniverse(clusterIdForIndex(0), clustering)).toEqual([
      'i1',
      'i2',
    ])
    expect(clusterIdeaUniverse(clusterIdForIndex(1), clustering)).toEqual([
      'i3',
    ])
  })

  it('excludes orphans — an orphan belongs to no cluster', () => {
    const all = [0, 1].flatMap(i =>
      clusterIdeaUniverse(clusterIdForIndex(i), clustering)
    )
    expect(all).not.toContain('i9')
  })

  it('fails soft to [] on an unresolvable id or a missing clustering', () => {
    expect(clusterIdeaUniverse('not-a-minted-id', clustering)).toEqual([])
    expect(clusterIdeaUniverse(clusterIdForIndex(9), clustering)).toEqual([])
    expect(clusterIdeaUniverse(clusterIdForIndex(0), undefined)).toEqual([])
  })
})

describe('resolveKeptIdeaIds', () => {
  const universe = ['i1', 'i2', 'i3']

  it('keeps the whole cluster when nothing was submitted', () => {
    expect(resolveKeptIdeaIds({ clusterId: 'cluster-0', universe })).toEqual(
      universe
    )
  })

  it('keeps only the submitted subset', () => {
    expect(
      resolveKeptIdeaIds({
        clusterId: 'cluster-0',
        universe,
        submitted: ['i1', 'i3'],
      })
    ).toEqual(['i1', 'i3'])
  })

  it('normalises to gate-A order', () => {
    expect(
      resolveKeptIdeaIds({
        clusterId: 'cluster-0',
        universe,
        submitted: ['i3', 'i1'],
      })
    ).toEqual(['i1', 'i3'])
  })

  it('accepts an explicitly emptied cluster', () => {
    expect(
      resolveKeptIdeaIds({ clusterId: 'cluster-0', universe, submitted: [] })
    ).toEqual([])
  })

  it('rejects an idea from outside the cluster with 422', () => {
    expect(() =>
      resolveKeptIdeaIds({
        clusterId: 'cluster-0',
        universe,
        submitted: ['i1', 'i9'],
      })
    ).toThrow(expect.objectContaining({ status: 422 }))
  })

  it('rejects a duplicate idea with 422', () => {
    expect(() =>
      resolveKeptIdeaIds({
        clusterId: 'cluster-0',
        universe,
        submitted: ['i1', 'i1'],
      })
    ).toThrow(expect.objectContaining({ status: 422 }))
  })
})
