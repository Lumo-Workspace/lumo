import { pickLatestCumulative } from '@/lib/repositories/session.repository'

const m = (input: number, output = 0, cacheRead = 0, cacheCreation = 0) => ({
  'claude-opus-4-8': { input, output, cacheRead, cacheCreation },
})

describe('pickLatestCumulative', () => {
  it('returns the snapshot with the larger total cumulative is monotonic', () => {
    expect(pickLatestCumulative(m(100), m(50))).toEqual(m(100))
    expect(pickLatestCumulative(m(50), m(100))).toEqual(m(100))
  })
  it('handles nulls', () => {
    expect(pickLatestCumulative(null, m(10))).toEqual(m(10))
    expect(pickLatestCumulative(m(10), null)).toEqual(m(10))
    expect(pickLatestCumulative(null, null)).toBeNull()
  })
})
