import {
  buildMilestoneSlugBase,
  resolveUniqueMilestoneSlug,
} from '@/lib/utils/milestone-slug'

describe('buildMilestoneSlugBase', () => {
  it('slugifies a regular ascii name', () => {
    expect(buildMilestoneSlugBase('Q3 Launch')).toBe('q3-launch')
  })

  it('drops punctuation and collapses dashes', () => {
    expect(buildMilestoneSlugBase('v1.0 — first release!')).toBe(
      'v1-0-first-release'
    )
  })

  it('falls back to "milestone" when the name has no ascii alphanumerics', () => {
    expect(buildMilestoneSlugBase('里程碑')).toBe('milestone')
    expect(buildMilestoneSlugBase('!!!')).toBe('milestone')
    expect(buildMilestoneSlugBase('')).toBe('milestone')
  })
})

describe('resolveUniqueMilestoneSlug', () => {
  it('returns the base when no collision', () => {
    expect(resolveUniqueMilestoneSlug('q3-launch', new Set())).toBe('q3-launch')
  })

  it('appends -2 on the first collision', () => {
    expect(
      resolveUniqueMilestoneSlug('q3-launch', new Set(['q3-launch']))
    ).toBe('q3-launch-2')
  })

  it('skips taken suffixes and finds the next free one', () => {
    expect(
      resolveUniqueMilestoneSlug(
        'q3-launch',
        new Set(['q3-launch', 'q3-launch-2', 'q3-launch-3'])
      )
    ).toBe('q3-launch-4')
  })

  it('does not mistake an unrelated suffix for a collision', () => {
    expect(
      resolveUniqueMilestoneSlug('q3-launch', new Set(['q3-launch-prep']))
    ).toBe('q3-launch')
  })
})
