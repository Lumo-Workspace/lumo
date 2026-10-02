import { matchAllTaskIdentifiers } from '../../shared/src/task-identifier'

describe('matchAllTaskIdentifiers', () => {
  it('returns every identifier once, upper-cased, in order, skipping acronyms', () => {
    expect(
      matchAllTaskIdentifiers('fix lum-12 and SPEC-3, see LUM-12 and UTF-8')
    ).toEqual(['LUM-12', 'SPEC-3'])
    expect(matchAllTaskIdentifiers('nothing here')).toEqual([])
  })
})

describe('matchAllTaskIdentifiers bounds', () => {
  it('stops after 20 distinct identifiers by default, keeping order', () => {
    const text = Array.from({ length: 30 }, (_, i) => `LUM-${i + 1}`).join(' ')
    const out = matchAllTaskIdentifiers(text)
    expect(out).toHaveLength(20)
    expect(out[0]).toBe('LUM-1')
    expect(out[19]).toBe('LUM-20')
  })

  it('honours an explicit limit and ignores duplicates when counting', () => {
    expect(matchAllTaskIdentifiers('LUM-1 LUM-1 LUM-2 LUM-3', 2)).toEqual([
      'LUM-1',
      'LUM-2',
    ])
  })
})
