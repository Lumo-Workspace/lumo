import { matchAllTaskIdentifiers } from '../../shared/src/task-identifier'

describe('matchAllTaskIdentifiers', () => {
  it('returns every identifier once, upper-cased, in order, skipping acronyms', () => {
    expect(
      matchAllTaskIdentifiers('fix lum-12 and SPEC-3, see LUM-12 and UTF-8')
    ).toEqual(['LUM-12', 'SPEC-3'])
    expect(matchAllTaskIdentifiers('nothing here')).toEqual([])
  })
})
