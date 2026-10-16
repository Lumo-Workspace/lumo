/** @jest-environment node */
import { formatTraceCache } from '@/ee/security/security-scan/hunt/trace-cache'

describe('LUM-1224 formatTraceCache', () => {
  it('sums input and the cache share over the steps, counting a missing field as 0', () => {
    expect(
      formatTraceCache([
        { i: 1, inputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0 },
        {
          i: 2,
          inputTokens: 5000,
          cacheReadTokens: 4100,
          cacheWriteTokens: 300,
        },
        { i: 3, inputTokens: 5600 },
      ])
    ).toBe('steps=3 in=13600 cacheRead=4100 cacheWrite=300')
    expect(formatTraceCache([])).toBe('steps=0 in=0 cacheRead=0 cacheWrite=0')
  })
})
