// __tests__/lib/context/budget.test.ts
/** @jest-environment node */
import { estimateTokens } from '@/lib/context/budget'

describe('estimateTokens', () => {
  it('approximates length / 4, rounded up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})
