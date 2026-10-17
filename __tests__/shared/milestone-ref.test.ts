import {
  ambiguousMilestoneError,
  matchMilestoneRef,
  milestoneHandle,
} from '@/shared/src/milestone-ref'

const A = { id: 'm-a', name: 'Beta', slug: 'beta' }
const B = { id: 'm-b', name: 'Beta', slug: 'beta-2' }
const C = { id: 'm-c', name: 'Gamma', slug: 'gamma' }

describe('matchMilestoneRef (LUM-1230)', () => {
  it('id beats everything', () => {
    expect(matchMilestoneRef('m-b', [A, B, C])).toEqual({
      kind: 'found',
      milestone: B,
    })
  })

  it('an exact slug picks one even when the name is shared', () => {
    expect(matchMilestoneRef('beta-2', [A, B, C])).toEqual({
      kind: 'found',
      milestone: B,
    })
    expect(matchMilestoneRef('beta', [A, B, C])).toEqual({
      kind: 'found',
      milestone: A,
    })
  })

  it('a slug typed in another case still resolves (was case-insensitive before)', () => {
    const h = { id: 'm-h', name: 'Headless 化', slug: 'headless-web-cli' }
    expect(matchMilestoneRef('HEADLESS-WEB-CLI', [h, A])).toEqual({
      kind: 'found',
      milestone: h,
    })
  })

  it('a shared name is ambiguous', () => {
    expect(matchMilestoneRef('Beta', [A, B, C])).toEqual({
      kind: 'ambiguous',
      candidates: [A, B],
    })
  })

  it('a slug present in two projects is ambiguous', () => {
    const other = { ...A, id: 'm-x', projectId: 'p-2' }
    expect(matchMilestoneRef('beta', [A, other])).toEqual({
      kind: 'ambiguous',
      candidates: [A, other],
    })
  })

  it('names match case-insensitively; no slug from an older server is fine', () => {
    const old = { id: 'm-o', name: 'Q3 Launch' }
    expect(matchMilestoneRef('q3 launch', [old])).toEqual({
      kind: 'found',
      milestone: old,
    })
  })

  it('reports not-found', () => {
    expect(matchMilestoneRef('delta', [A, B, C])).toEqual({
      kind: 'not-found',
    })
  })
})

describe('milestoneHandle / ambiguousMilestoneError', () => {
  it('prefers the slug, falls back to the name', () => {
    expect(milestoneHandle(A)).toBe('beta')
    expect(milestoneHandle({ id: 'x', name: 'Old' })).toBe('Old')
  })

  it('lists candidates by slug and never prints ids', () => {
    const msg = ambiguousMilestoneError('Beta', [A, B])
    expect(msg).toContain('beta ("Beta"), beta-2 ("Beta")')
    expect(msg).toContain('re-run with one of these slugs')
    expect(msg).not.toContain('m-a')
  })

  it('asks for --project when the candidates share a slug', () => {
    const msg = ambiguousMilestoneError('beta', [A, { ...A, id: 'm-x' }])
    expect(msg).toContain('--project')
  })
})
