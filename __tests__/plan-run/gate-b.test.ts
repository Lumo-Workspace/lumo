import { selectStarredAligned, MAX_STARRED } from '@/lib/plan-run/gate-b'
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
})
