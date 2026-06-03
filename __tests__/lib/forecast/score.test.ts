import { tagJaccard, scoreCandidate } from '@/lib/forecast/score'

describe('tagJaccard', () => {
  it('is 0 when either set is empty', () => {
    expect(tagJaccard([], ['a'])).toBe(0)
    expect(tagJaccard(['a'], [])).toBe(0)
  })

  it('computes intersection over union, case-insensitive', () => {
    expect(tagJaccard(['a', 'b'], ['B', 'c'])).toBeCloseTo(1 / 3)
  })

  it('is 1 for identical sets', () => {
    expect(tagJaccard(['a', 'b'], ['a', 'b'])).toBe(1)
  })
})

describe('scoreCandidate', () => {
  it('blends 0.7 title + 0.3 tag, identical → 1', () => {
    const s = scoreCandidate(
      { title: 'Add OAuth login', tags: ['auth'] },
      { title: 'Add OAuth login', tags: ['auth'] }
    )
    expect(s).toBeCloseTo(1)
  })

  it('degrades gracefully when tags are absent (title-only)', () => {
    const s = scoreCandidate(
      { title: 'Add OAuth login', tags: [] },
      { title: 'Add OAuth login', tags: [] }
    )
    expect(s).toBeCloseTo(0.7)
  })

  it('rewards tag overlap on top of weak title match', () => {
    const withTags = scoreCandidate(
      { title: 'alpha', tags: ['x'] },
      { title: 'zzzzzz', tags: ['x'] }
    )
    const withoutTags = scoreCandidate(
      { title: 'alpha', tags: ['x'] },
      { title: 'zzzzzz', tags: ['y'] }
    )
    expect(withTags).toBeGreaterThan(withoutTags)
  })
})
